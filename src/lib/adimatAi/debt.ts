import { DEFAULT_DEBT_REMINDER_TEMPLATE, renderDebtReminderMessage } from '../debtReminderConfig';
import { daysBetween, parseDate, roundTo } from './dates';
import { nowOf } from './snapshot';
import type { AiSnapshot, DebtPriority } from './types';

export const AI_SMS_MAX_CHARS = 160;

export function fitSms(message: string, max = AI_SMS_MAX_CHARS): string {
  const trimmed = message.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  const sliced = trimmed.slice(0, max);
  const space = sliced.lastIndexOf(' ');
  const cut = space >= Math.floor(max * 0.7) ? sliced.slice(0, space) : sliced;
  return cut.trim();
}

export interface CustomerDebt {
  customerId: string;
  name: string;
  phone: string;
  owed: number;
  daysSincePayment: number;
  score: number;
  optOut: boolean;
  lastReminder: string;
}

export function rankCustomerDebt(snapshot: AiSnapshot): CustomerDebt[] {
  const now = nowOf(snapshot);
  const creditByCustomer = new Map<string, { owed: number; oldest: string | null }>();
  for (const sale of snapshot.sales) {
    if (!sale.customerId || sale.creditBalance <= 0) continue;
    const current = creditByCustomer.get(sale.customerId) || { owed: 0, oldest: null };
    current.owed += sale.creditBalance;
    if (!current.oldest || sale.createdAt < current.oldest) current.oldest = sale.createdAt;
    creditByCustomer.set(sale.customerId, current);
  }
  const lastPayment = new Map<string, string>();
  for (const payment of snapshot.payments) {
    const previous = lastPayment.get(payment.customerId);
    if (!previous || payment.createdAt > previous) lastPayment.set(payment.customerId, payment.createdAt);
  }
  const lastReminder = new Map<string, string>();
  for (const reminder of snapshot.reminders) {
    const previous = lastReminder.get(reminder.customerId);
    if (!previous || reminder.sentAt > previous) lastReminder.set(reminder.customerId, reminder.sentAt);
  }

  const rows: CustomerDebt[] = [];
  for (const customer of snapshot.customers) {
    const credit = creditByCustomer.get(customer.id);
    const owed = roundTo((credit?.owed || 0) + Math.max(0, customer.openingRemaining), 2);
    if (owed <= 0) continue;
    const paidAt = lastPayment.get(customer.id);
    const anchor = paidAt || credit?.oldest || customer.createdAt || snapshot.now;
    const days = Math.max(0, daysBetween(now, parseDate(anchor)));
    rows.push({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      owed,
      daysSincePayment: days,
      score: roundTo(owed * days, 2),
      optOut: customer.optOut,
      lastReminder: lastReminder.get(customer.id) || '',
    });
  }
  rows.sort((a, b) => b.score - a.score || b.owed - a.owed);
  return rows;
}

export function analyzeDebt(snapshot: AiSnapshot): DebtPriority[] {
  const template = snapshot.debtTemplate.trim() || DEFAULT_DEBT_REMINDER_TEMPLATE;
  return rankCustomerDebt(snapshot).slice(0, 20).map((row) => {
    const message = fitSms(renderDebtReminderMessage(template, {
      customerName: row.name,
      storeName: snapshot.storeName || 'our store',
      balance: String(row.owed),
    }));
    return {
      ...row,
      message,
      confidence: row.daysSincePayment >= 7 ? 'high' : 'medium',
      whyKey: 'ai.why.debt',
      whyVars: {
        name: row.name,
        owedMoney: row.owed,
        days: row.daysSincePayment,
        score: row.score,
        reminder: row.lastReminder ? row.lastReminder.slice(0, 10) : 'never',
      },
    };
  });
}

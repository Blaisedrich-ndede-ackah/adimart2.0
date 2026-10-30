/**
 * Automated debt reminders.
 *
 * Store owners can let Adimat chase outstanding customer credit over SMS.
 * The store owns the rules (on/off, how often, minimum balance, message
 * wording) and Adimat runs the sweep on its own whenever the app is open.
 *
 * Every attempt is written to `debt_reminders` so the owner can see who was
 * chased, when, and what was sent.
 */

import {
  db,
  generateId,
  getCurrentStore,
  type LocalCustomer,
  type LocalDebtReminder,
  type LocalStore,
} from '@/lib/dexie';
import { buildCustomerBalances, type CustomerBalance } from '@/lib/customerBalances';
import { sendSmsViaMnotify, normalizeRecipientList } from '@/lib/mnotify';
import { formatOfficialMoney } from '@/lib/currency';
import {
  DEBT_REMINDER_MAX_CHARS,
  DEFAULT_DEBT_REMINDER_INTERVAL_DAYS,
  DEFAULT_DEBT_REMINDER_TEMPLATE,
  normalizeDebtReminderIntervalDays,
  normalizeDebtReminderMinBalance,
  normalizeDebtReminderTemplate,
  renderDebtReminderMessage,
  type DebtReminderSettings,
} from '@/lib/debtReminderConfig';

export {
  DEBT_REMINDER_INTERVAL_OPTIONS,
  DEBT_REMINDER_MAX_CHARS,
  DEFAULT_DEBT_REMINDER_INTERVAL_DAYS,
  DEFAULT_DEBT_REMINDER_TEMPLATE,
} from '@/lib/debtReminderConfig';

export interface DebtReminderCandidate {
  customer: LocalCustomer;
  balance: number;
  phone: string;
  lastReminderAt: string | null;
}

export interface DebtReminderRunResult {
  /** True when the sweep actually attempted to send messages. */
  ran: boolean;
  reason: string;
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read the owner-configured reminder rules off a store row. */
export function resolveDebtReminderSettings(store: Partial<LocalStore> | null | undefined): DebtReminderSettings {
  return {
    enabled: (store?.debt_reminders_enabled ?? 0) === 1,
    intervalDays: normalizeDebtReminderIntervalDays(store?.debt_reminder_interval_days),
    minBalance: normalizeDebtReminderMinBalance(store?.debt_reminder_min_balance),
    messageTemplate: normalizeDebtReminderTemplate(store?.debt_reminder_message),
  };
}

/** Persist the owner-configured reminder rules for a store. */
export async function saveDebtReminderSettings(
  storeId: string,
  settings: DebtReminderSettings
): Promise<void> {
  await db.stores.update(storeId, {
    debt_reminders_enabled: settings.enabled ? 1 : 0,
    debt_reminder_interval_days: normalizeDebtReminderIntervalDays(settings.intervalDays),
    debt_reminder_min_balance: normalizeDebtReminderMinBalance(settings.minBalance),
    debt_reminder_message: normalizeDebtReminderTemplate(settings.messageTemplate),
    synced: 0,
  });
}

/** True when the customer asked not to be chased by SMS. */
export function isOptedOut(customer: LocalCustomer): boolean {
  return (customer.debt_reminder_opt_out ?? 0) === 1;
}

/** Let the owner opt a single customer out of automated reminders. */
export async function setCustomerDebtReminderOptOut(
  customerId: string,
  optedOut: boolean
): Promise<void> {
  await db.customers.update(customerId, {
    debt_reminder_opt_out: optedOut ? 1 : 0,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

/** Most recent reminder attempt for a customer, newest first. */
export async function getLastReminderForCustomer(customerId: string): Promise<LocalDebtReminder | null> {
  const rows = await db.debt_reminders.where('customer_id').equals(customerId).toArray();
  rows.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return rows[0] ?? null;
}

/** Reminder history for a store, newest first. */
export async function getDebtReminderHistory(
  storeId: string,
  limit = 20
): Promise<LocalDebtReminder[]> {
  const rows = await db.debt_reminders.where('store_id').equals(storeId).toArray();
  rows.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return rows.slice(0, limit);
}

/** True when a customer is due another reminder under the store's interval. */
export function isReminderDue(
  candidate: Pick<DebtReminderCandidate, 'lastReminderAt'>,
  intervalDays: number,
  now = Date.now()
): boolean {
  if (!candidate.lastReminderAt) return true;
  const sentAt = new Date(candidate.lastReminderAt).getTime();
  if (!Number.isFinite(sentAt)) return true;
  return now - sentAt >= intervalDays * DAY_MS;
}

/**
 * Customers who owe money, have a phone number, and have not opted out.
 * `includeOptedOut` is used by the owner-facing preview so they can still
 * see who is excluded.
 */
export async function listDebtReminderCandidates(
  storeId: string,
  settings: DebtReminderSettings,
  options: { includeOptedOut?: boolean; onlyDue?: boolean; now?: number } = {}
): Promise<DebtReminderCandidate[]> {
  if (!storeId) return [];
  const now = options.now ?? Date.now();
  const balances = await buildCustomerBalances(storeId);
  const customers = await db.customers.where('store_id').equals(storeId).toArray();

  const candidates: DebtReminderCandidate[] = [];
  for (const customer of customers) {
    const balance = balances.get(customer.id);
    const total = balance ? balance.total : 0;
    if (total <= 0) continue;
    if (total + 0.001 < settings.minBalance) continue;
    if (!options.includeOptedOut && isOptedOut(customer)) continue;

    const phone = normalizeRecipientList([customer.phone || ''])[0] ?? '';
    const last = await getLastReminderForCustomer(customer.id);
    const lastReminderAt = last ? last.sent_at : null;

    if (options.onlyDue && !isReminderDue({ lastReminderAt }, settings.intervalDays, now)) {
      continue;
    }

    candidates.push({ customer, balance: total, phone, lastReminderAt });
  }

  candidates.sort((a, b) => b.balance - a.balance);
  return candidates;
}

async function recordReminder(
  row: Omit<LocalDebtReminder, 'id' | 'created_at' | 'synced'>
): Promise<LocalDebtReminder> {
  const reminder: LocalDebtReminder = {
    ...row,
    id: generateId(),
    created_at: new Date().toISOString(),
    synced: 0,
  };
  await db.debt_reminders.add(reminder);
  return reminder;
}

/** Send one reminder ADIMAT AI already wrote. The shop owner confirms first. */
export async function sendPreparedDebtReminder(input: {
  storeId: string;
  customerId: string;
  customerName: string;
  phone: string;
  balance: number;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const message = input.message.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!input.storeId || !input.customerId) return { ok: false, error: 'No customer selected.' };
  if (!message) return { ok: false, error: 'Write a reminder before sending.' };
  if (!input.phone.trim()) {
    await recordReminder({
      store_id: input.storeId,
      customer_id: input.customerId,
      customer_name: input.customerName,
      customer_phone: '',
      balance: input.balance,
      message,
      provider: 'mnotify',
      provider_message_id: null,
      status: 'skipped',
      error_message: 'No phone number on file',
      sent_at: new Date().toISOString(),
    });
    return { ok: false, error: 'No phone number on file.' };
  }
  const sendResult = await sendSmsViaMnotify(input.phone, message);
  await recordReminder({
    store_id: input.storeId,
    customer_id: input.customerId,
    customer_name: input.customerName,
    customer_phone: input.phone,
    balance: input.balance,
    message,
    provider: 'mnotify',
    provider_message_id: null,
    status: sendResult.success ? 'sent' : 'failed',
    error_message: sendResult.success ? null : sendResult.error || 'Unknown error',
    sent_at: new Date().toISOString(),
  });
  return { ok: sendResult.success, error: sendResult.success ? undefined : sendResult.error || 'Could not send the reminder.' };
}

/**
 * Run one reminder sweep for a store.
 *
 * `force` ignores the per-customer interval so the owner can chase a
 * customer immediately from the Customers screen.
 */
export async function sendDebtRemindersForStore(
  store: LocalStore,
  options: { force?: boolean } = {}
): Promise<DebtReminderRunResult> {
  const settings = resolveDebtReminderSettings(store);
  const result: DebtReminderRunResult = {
    ran: false,
    reason: '',
    eligible: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  if (!store.id) {
    result.reason = 'No store selected.';
    return result;
  }
  if (!settings.enabled && !options.force) {
    result.reason = 'Automatic debt reminders are turned off for this store.';
    return result;
  }

  const candidates = await listDebtReminderCandidates(store.id, settings, {
    onlyDue: !options.force,
  });
  result.eligible = candidates.length;

  if (candidates.length === 0) {
    result.ran = true;
    result.reason = options.force
      ? 'No customers with an outstanding balance and a phone number.'
      : 'No customers are due a reminder right now.';
    return result;
  }

  result.ran = true;
  for (const candidate of candidates) {
    const balance = Math.round(candidate.balance * 100) / 100;
    const message = renderDebtReminderMessage(settings.messageTemplate, {
      customerName: candidate.customer.name,
      storeName: store.name || 'our store',
      balance: formatOfficialMoney(balance, store.currency_code),
    });

    if (!candidate.phone) {
      result.skipped += 1;
      await recordReminder({
        store_id: store.id,
        customer_id: candidate.customer.id,
        customer_name: candidate.customer.name,
        customer_phone: '',
        balance,
        message,
        provider: 'mnotify',
        provider_message_id: null,
        status: 'skipped',
        error_message: 'No phone number on file',
        sent_at: new Date().toISOString(),
      });
      continue;
    }

    const sendResult = await sendSmsViaMnotify(candidate.phone, message);
    if (sendResult.error === 'mNotify API key not configured') {
      // Nothing can be sent on this device. Stop the sweep without burning
      // each customer's reminder interval on a failed attempt.
      result.reason = 'mNotify API key is not configured on this device.';
      return result;
    }
    if (sendResult.success) {
      result.sent += 1;
    } else {
      result.failed += 1;
    }

    await recordReminder({
      store_id: store.id,
      customer_id: candidate.customer.id,
      customer_name: candidate.customer.name,
      customer_phone: candidate.phone,
      balance,
      message,
      provider: 'mnotify',
      provider_message_id: null,
      status: sendResult.success ? 'sent' : 'failed',
      error_message: sendResult.success ? null : sendResult.error || 'Unknown error',
      sent_at: new Date().toISOString(),
    });
  }

  result.reason =
    result.sent > 0
      ? `Sent ${result.sent} reminder${result.sent === 1 ? '' : 's'}.`
      : `Could not send reminders (${result.failed} failed, ${result.skipped} skipped).`;
  return result;
}

/**
 * Background sweep for the signed-in store. Safe to call repeatedly: each
 * customer is only chased again once the configured interval has passed.
 */
export async function checkAndSendDebtReminders(): Promise<DebtReminderRunResult> {
  const store = await getCurrentStore();
  if (!store) {
    return { ran: false, reason: 'No store selected.', eligible: 0, sent: 0, failed: 0, skipped: 0 };
  }
  const settings = resolveDebtReminderSettings(store);
  if (!settings.enabled) {
    return {
      ran: false,
      reason: 'Automatic debt reminders are turned off for this store.',
      eligible: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }
  try {
    return await sendDebtRemindersForStore(store);
  } catch (error) {
    console.error('[DebtReminders] Automatic reminder sweep failed:', error);
    return {
      ran: false,
      reason: error instanceof Error ? error.message : 'Automatic reminders failed.',
      eligible: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }
}

/** Convenience wrapper used by the app shell. */
export async function runDebtReminderSweepForCurrentStore(): Promise<DebtReminderRunResult> {
  return checkAndSendDebtReminders();
}

export type { CustomerBalance };
export { DEBT_REMINDER_MAX_CHARS as MAX_REMINDER_CHARS };

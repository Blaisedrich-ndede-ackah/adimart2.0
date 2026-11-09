import {
  db,
  type LocalCustomer,
  type LocalStore,
} from '@/lib/dexie';
import { FormalPdf, orgFromStore } from '@/lib/formalPdf';
import { roundMoney } from '@/lib/money';

export interface StatementEvent {
  at: string;
  label: string;
  debit: number;
  credit: number;
  points: number;
}

export interface StatementLine extends StatementEvent {
  balance: number;
}

export function rollStatement(events: StatementEvent[], from: string, to: string): {
  opening: number;
  lines: StatementLine[];
  closing: number;
} {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.label.localeCompare(b.label));
  let balance = 0;
  for (const event of sorted) {
    if (event.at.slice(0, 10) >= from) break;
    balance = roundMoney(balance + event.debit - event.credit);
  }
  const opening = balance;
  const lines: StatementLine[] = [];
  for (const event of sorted) {
    const day = event.at.slice(0, 10);
    if (day < from || day > to) continue;
    balance = roundMoney(balance + event.debit - event.credit);
    lines.push({ ...event, balance });
  }
  return { opening, lines, closing: balance };
}

export async function buildCustomerStatement(customerId: string, from: string, to: string): Promise<{
  customer: LocalCustomer;
  opening: number;
  lines: StatementLine[];
  closing: number;
}> {
  const customer = await db.customers.get(customerId);
  if (!customer) throw new Error('Customer not found.');
  const [openings, sales, payments, returns, loyalty] = await Promise.all([
    db.customer_opening_payments.where('customer_id').equals(customerId).toArray(),
    db.transactions.where('customer_id').equals(customerId).toArray(),
    db.credit_payments.where('customer_id').equals(customerId).toArray(),
    db.sales_returns.where('store_id').equals(customer.store_id).toArray(),
    db.customer_loyalty_transactions.where('customer_id').equals(customerId).toArray(),
  ]);
  const events: StatementEvent[] = [];
  for (const row of openings) {
    if (row.entry_type === 'opening_balance') {
      events.push({ at: row.created_at, label: 'Opening balance', debit: Number(row.amount) || 0, credit: 0, points: 0 });
    } else {
      events.push({ at: row.created_at, label: `Account payment (${row.payment_method || 'cash'})`, debit: 0, credit: Number(row.amount) || 0, points: 0 });
    }
  }
  for (const sale of sales) {
    if (sale.payment_method !== 'credit' || sale.status !== 'completed') continue;
    events.push({
      at: sale.created_at,
      label: `Credit sale ${sale.receipt_number}`,
      debit: Number(sale.total_amount) || 0,
      credit: 0,
      points: 0,
    });
    if (sale.void_status === 'voided') {
      events.push({
        at: sale.voided_at || sale.updated_at || sale.created_at,
        label: `Void ${sale.receipt_number}`,
        debit: 0,
        credit: Number(sale.total_amount) || 0,
        points: 0,
      });
    }
  }
  for (const payment of payments) {
    events.push({
      at: payment.created_at,
      label: `Payment (${payment.payment_method})`,
      debit: 0,
      credit: Number(payment.amount) || 0,
      points: 0,
    });
  }
  for (const row of returns.filter((entry) => entry.customer_id === customerId)) {
    events.push({
      at: row.created_at,
      label: `Return ${row.receipt_number}`,
      debit: 0,
      credit: Number(row.debt_applied) || 0,
      points: 0,
    });
  }
  for (const row of loyalty) {
    events.push({
      at: row.created_at,
      label: row.type === 'earn' ? `Loyalty earned: ${row.points} pts` : `Loyalty redeemed: ${row.points} pts`,
      debit: 0,
      credit: 0,
      points: row.type === 'earn' ? row.points : -row.points,
    });
  }
  const rolled = rollStatement(events, from, to);
  return { customer, ...rolled };
}

export function statementText(input: {
  storeName: string;
  customerName: string;
  from: string;
  to: string;
  opening: number;
  lines: StatementLine[];
  closing: number;
  currency?: string;
}): string {
  const currency = input.currency || 'GHS';
  const money = (value: number) => `${currency} ${value.toFixed(2)}`;
  const rows = input.lines.map((line) => (
    `${line.at.slice(0, 10)} ${line.label} ${line.debit ? '+' + money(line.debit) : ''}${line.credit ? '-' + money(line.credit) : ''} bal ${money(line.balance)}`
  ));
  return [
    input.storeName,
    `Statement for ${input.customerName}`,
    `${input.from} to ${input.to}`,
    `Opening ${money(input.opening)}`,
    ...rows,
    `Closing ${money(input.closing)}`,
  ].join('\n');
}

export async function statementPdf(input: {
  store: LocalStore;
  customerName: string;
  from: string;
  to: string;
  opening: number;
  lines: StatementLine[];
  closing: number;
}): Promise<Blob> {
  const pdf = new FormalPdf(orgFromStore({
    name: input.store.name,
    address: input.store.address,
    support_number: input.store.support_number,
    logo_url: input.store.logo_url,
    currency_code: input.store.currency_code,
  }), {
    title: 'Customer account statement',
    subtitle: input.customerName,
    period: `${input.from} to ${input.to}`,
    documentLabel: 'ACCOUNT STATEMENT',
  });
  pdf.section('Balances');
  pdf.kvTable([
    { label: 'Opening balance', value: moneyLabel(input.opening, input.store.currency_code) },
    { label: 'Closing balance', value: moneyLabel(input.closing, input.store.currency_code), emphasis: 'total' },
  ]);
  pdf.section('Activity');
  pdf.dataTable(
    ['Date', 'Details', 'Charged', 'Paid', 'Balance'],
    [
      [input.from, 'Opening balance', '', '', moneyLabel(input.opening, input.store.currency_code)],
      ...input.lines.map((line) => [
        line.at.slice(0, 10),
        line.points ? `${line.label}` : line.label,
        line.debit ? moneyLabel(line.debit, input.store.currency_code) : '',
        line.credit ? moneyLabel(line.credit, input.store.currency_code) : '',
        moneyLabel(line.balance, input.store.currency_code),
      ]),
    ],
    [2, 4, 2, 2, 2]
  );
  return pdf.outputBlob();
}

function moneyLabel(value: number, currency?: string): string {
  return `${currency || 'GHS'} ${value.toFixed(2)}`;
}

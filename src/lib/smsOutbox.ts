import { db, generateId, type LocalSmsOutbox, type LocalStore } from '@/lib/dexie';
import { sendStoreSms } from '@/lib/smsWallet';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { isCountedSale } from '@/lib/saleStatus';
import { roundMoney } from '@/lib/money';
import { formatQty } from '@/lib/measure';

export function receiptSmsText(input: {
  storeName: string;
  receiptNumber: string;
  lines: Array<{ name: string; quantity: number; unit?: string; subtotal: number }>;
  total: number;
  paymentMethod: string;
  currency?: string;
}): string {
  const currency = input.currency || 'GHS';
  const itemLines = input.lines.slice(0, 8).map((line) => (
    `${line.name} ${formatQty(line.quantity, line.unit)} = ${currency} ${line.subtotal.toFixed(2)}`
  ));
  return [
    input.storeName,
    `Receipt ${input.receiptNumber}`,
    ...itemLines,
    `Total ${currency} ${input.total.toFixed(2)}`,
    input.paymentMethod,
    'Thank you.',
  ].join('\n').slice(0, 480);
}

export function closingSmsText(input: {
  storeName: string;
  date: string;
  salesTotal: number;
  cash: number;
  momo: number;
  credit: number;
  salesCount: number;
  voids: number;
  expenses: number;
  currency?: string;
}): string {
  const currency = input.currency || 'GHS';
  const money = (value: number) => `${currency} ${roundMoney(value).toFixed(2)}`;
  const net = roundMoney(input.salesTotal - input.expenses);
  return [
    `${input.storeName} closing ${input.date}`,
    `Sales ${money(input.salesTotal)} (${input.salesCount})`,
    `Cash ${money(input.cash)}`,
    `MoMo ${money(input.momo)}`,
    `Credit ${money(input.credit)}`,
    `Voids ${input.voids}`,
    `Expenses ${money(input.expenses)}`,
    `Net ${money(net)} (sales minus expenses)`,
  ].join('\n');
}

export async function queueSms(input: {
  storeId: string;
  kind: LocalSmsOutbox['kind'];
  recipient: string;
  message: string;
}): Promise<LocalSmsOutbox> {
  const now = new Date().toISOString();
  const row: LocalSmsOutbox = {
    id: generateId(),
    store_id: input.storeId,
    kind: input.kind,
    recipient: input.recipient.trim(),
    message: input.message,
    status: 'queued',
    error_message: '',
    created_at: now,
    sent_at: null,
    synced: 0,
  };
  await db.sms_outbox.add(row);
  if (typeof navigator === 'undefined' || navigator.onLine) {
    await flushSmsOutbox(input.storeId);
  }
  return (await db.sms_outbox.get(row.id)) || row;
}

const smsSendInFlight = new Set<string>();

export async function flushSmsOutbox(storeId: string): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  const queued = await db.sms_outbox.where('store_id').equals(storeId).and((row) => row.status === 'queued').toArray();
  let sent = 0;
  for (const row of queued) {
    if (smsSendInFlight.has(row.id)) continue;
    smsSendInFlight.add(row.id);
    try {
      const result = await sendStoreSms({
        storeId,
        kind: row.kind === 'closing' ? 'closing' : 'receipt',
        recipients: [row.recipient],
        message: row.message,
      });
      const now = new Date().toISOString();
      if (result.ok) {
        await db.sms_outbox.update(row.id, { status: 'sent', sent_at: now, error_message: '', synced: 0 });
        sent += 1;
      } else if (!(result.retryable && typeof navigator !== 'undefined' && navigator.onLine === false)) {
        await db.sms_outbox.update(row.id, {
          status: 'failed',
          error_message: (result.error || 'SMS failed').slice(0, 300),
          synced: 0,
        });
      }
    } finally {
      smsSendInFlight.delete(row.id);
    }
  }
  return sent;
}

export async function todayClosingFigures(storeId: string, day = new Date()): Promise<{
  salesTotal: number;
  cash: number;
  momo: number;
  credit: number;
  salesCount: number;
  voids: number;
  expenses: number;
}> {
  const date = day.toISOString().slice(0, 10);
  const [sales, expenses] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.expenses.where('store_id').equals(storeId).toArray(),
  ]);
  const sameDay = (value?: string | null) => (value || '').slice(0, 10) === date;
  const counted = sales.filter((sale) => isCountedSale(sale) && sameDay(sale.created_at));
  const voids = sales.filter((sale) => sale.void_status === 'voided' && sameDay(sale.voided_at || sale.updated_at)).length;
  const dayExpenses = expenses.filter((expense) => sameDay(expense.expense_date || expense.created_at));
  return {
    salesTotal: roundMoney(counted.reduce((sum, sale) => sum + (Number(sale.total_amount) || 0), 0)),
    cash: roundMoney(counted.reduce((sum, sale) => sum + (Number(sale.cash_amount) || 0), 0)),
    momo: roundMoney(counted.reduce((sum, sale) => sum + (Number(sale.paystack_amount) || 0) + (Number(sale.manual_payment_amount) || 0), 0)),
    credit: roundMoney(counted.reduce((sum, sale) => sum + (sale.payment_method === 'credit' ? Number(sale.total_amount) || 0 : 0), 0)),
    salesCount: counted.length,
    voids,
    expenses: roundMoney(dayExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)),
  };
}

export async function sendClosingSummary(store: LocalStore, force = false): Promise<'sent' | 'queued' | 'skipped'> {
  if ((store.closing_sms_enabled ?? 0) !== 1 && !force) return 'skipped';
  const phone = (store.support_number || '').trim();
  if (!phone) return 'skipped';
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const [hour, minute] = (store.closing_sms_time || '20:00').split(':').map((part) => Number(part) || 0);
  const due = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
  if (!force && !due) return 'skipped';
  const existing = await db.sms_outbox.where('store_id').equals(store.id).and((row) => (
    row.kind === 'closing' && row.created_at.slice(0, 10) === date && row.status !== 'failed'
  )).toArray();
  if (existing.length > 0 && !force) return 'skipped';
  const figures = await todayClosingFigures(store.id, now);
  await queueSms({
    storeId: store.id,
    kind: 'closing',
    recipient: phone,
    message: closingSmsText({
      storeName: store.name,
      date,
      ...figures,
      currency: store.currency_code || 'GHS',
    }),
  });
  const latest = await db.sms_outbox.where('store_id').equals(store.id).reverse().sortBy('created_at');
  return latest[0]?.status === 'sent' ? 'sent' : 'queued';
}

export async function pushSmsOutbox(storeId: string): Promise<{ synced: number; error: string }> {
  if (!isSupabaseConfigured()) return { synced: 0, error: '' };
  const rows = await db.sms_outbox.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  if (rows.length === 0) return { synced: 0, error: '' };
  const { error } = await supabase.from('sms_outbox').upsert(rows.map((row) => ({
    id: row.id,
    store_id: row.store_id,
    kind: row.kind,
    recipient: row.recipient,
    message: row.message,
    status: row.status,
    error_message: row.error_message || '',
    created_at: row.created_at,
    sent_at: row.sent_at,
  })), { onConflict: 'id' });
  if (error) {
    if (/does not exist|PGRST205|schema cache/i.test(error.message || '')) return { synced: 0, error: '' };
    return { synced: 0, error: `SMS outbox: ${error.message}` };
  }
  await Promise.all(rows.map((row) => db.sms_outbox.update(row.id, { synced: 1 })));
  return { synced: rows.length, error: '' };
}

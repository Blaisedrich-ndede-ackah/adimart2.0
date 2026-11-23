import { db, generateId, type LocalReceiptToken, type LocalTransaction, type LocalTransactionItem } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { triggerPushSync } from '@/lib/sync';

export type ReceiptToken = LocalReceiptToken;
export interface PublicReceipt {
  store_name: string;
  store_logo_url: string;
  receipt_number: string;
  cashier_name: string;
  created_at: string;
  total_amount: number;
  discount_applied: number;
  payment_method: string;
  currency_code: string;
  expires_at: string;
  items: Array<{ product_name: string; quantity: number; unit_price: number; subtotal: number }>;
}
export interface ValidatedReceipt {
  valid: boolean;
  transaction?: LocalTransaction;
  items?: LocalTransactionItem[];
  receipt?: PublicReceipt;
}

function randomToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint8Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

export function getPublicReceiptUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/receipt/${encodeURIComponent(token)}`;
}

export async function generateReceiptToken(transactionId: string, receiptNumber: string, ttlHours: number): Promise<ReceiptToken> {
  const transaction = await db.transactions.get(transactionId);
  if (!transaction || !receiptNumber || transaction.receipt_number !== receiptNumber) throw new Error('Sale receipt could not be found.');
  const token = randomToken();
  const createdAt = new Date().toISOString();
  const hours = Math.max(1, Math.min(8760, Math.floor(Number(ttlHours) || 720)));
  const row: ReceiptToken = {
    id: generateId(), store_id: transaction.store_id, transaction_id: transaction.id,
    receipt_number: receiptNumber, token, qr_payload: getPublicReceiptUrl(token),
    created_at: createdAt, expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(), synced: 0,
  };
  await db.receipt_tokens.add(row);

  // Push the completed sale and its items before publishing the bearer token.
  // The public receipt lookup joins all three cloud tables, so inserting the
  // token first can make a just-issued QR open as not found on another phone.
  if (isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine)) {
    await triggerPushSync('digital-receipt-sale');

    // triggerPushSync can return while a different tab owns the sync lock.
    // Wait briefly for this sale's local synced marker before inserting the
    // token, otherwise the database's completed-sale policy rejects it. The
    // receipt lookup also needs the sale items, so wait for those as well.
    const syncDeadline = Date.now() + 8_000;
    let syncedTransaction = await db.transactions.get(transactionId);
    let saleItems = await db.transaction_items.where('transaction_id').equals(transactionId).toArray();
    while ((syncedTransaction?.synced !== 1 || saleItems.some((item) => item.synced !== 1)) && Date.now() < syncDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      syncedTransaction = await db.transactions.get(transactionId);
      saleItems = await db.transaction_items.where('transaction_id').equals(transactionId).toArray();
    }
    if (syncedTransaction?.synced !== 1 || saleItems.some((item) => item.synced !== 1)) {
      throw new Error('Sale completed, but the digital receipt is waiting for cloud sync. Keep the POS online and try again shortly.');
    }

    await syncReceipts(row.store_id);
    let saved = await db.receipt_tokens.get(row.id);
    if (saved?.synced !== 1) {
      // A concurrent sync may queue the first push instead of waiting for it.
      await triggerPushSync('digital-receipt-sale-retry');
      await syncReceipts(row.store_id);
      saved = await db.receipt_tokens.get(row.id);
    }
    if (saved?.synced !== 1) {
      throw new Error('Sale completed, but the digital receipt could not be published. Check the Supabase receipt setup and retry.');
    }
    return saved || row;
  }
  return (await db.receipt_tokens.get(row.id)) || row;
}

export async function validateReceiptToken(token: string): Promise<ValidatedReceipt> {
  const normalized = token.trim().toUpperCase();
  if (!normalized) return { valid: false };
  const row = await db.receipt_tokens.where('token').equals(normalized).first();
  if (!row && isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine)) {
    // The cashier may still be publishing the token when the customer scans
    // immediately. Retry empty results briefly so a just-paid receipt opens.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await supabase.rpc('get_public_receipt', { receipt_token: normalized });
      if (!error && data && typeof data === 'object') {
        return { valid: true, receipt: data as PublicReceipt };
      }
      if (error) return { valid: false };
      if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    }
    return { valid: false };
  }
  if (!row || Date.parse(row.expires_at) <= Date.now()) return { valid: false };
  const transaction = await db.transactions.get(row.transaction_id);
  if (!transaction) return { valid: false };
  const [items, store] = await Promise.all([
    db.transaction_items.where('transaction_id').equals(row.transaction_id).toArray(),
    db.stores.get(row.store_id),
  ]);
  const receipt: PublicReceipt = {
    store_name: store?.name || 'Adimat Store', store_logo_url: store?.logo_url || '',
    receipt_number: transaction.receipt_number, cashier_name: transaction.cashier_name,
    created_at: transaction.created_at, total_amount: transaction.total_amount,
    discount_applied: transaction.discount_applied, payment_method: transaction.payment_method,
    currency_code: store?.currency_code || 'GHS',
    expires_at: row.expires_at,
    items: items.map((item) => ({ product_name: item.product_name, quantity: item.quantity, unit_price: item.unit_price, subtotal: item.subtotal })),
  };
  return { valid: true, transaction, items, receipt };
}

export async function syncReceipts(storeId: string): Promise<number> {
  if (!storeId || !isSupabaseConfigured() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  const pending = await db.receipt_tokens.where('store_id').equals(storeId).filter((row) => row.synced === 0).toArray();
  let count = 0;
  for (const row of pending) {
    const { synced: _localSynced, ...cloudRow } = row;
    const { error } = await supabase.from('receipt_tokens').insert(cloudRow);
    if (!error || error.code === '23505') {
      await db.receipt_tokens.update(row.id, { synced: 1 });
      count++;
    }
  }
  return count;
}

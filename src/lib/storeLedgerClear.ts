/**
 * Super-admin wipe of a store's trial sales ledger.
 *
 * Cloud delete is not enough: devices keep IndexedDB copies and pull only
 * upserts, so old sales stay on the phone. On sync we:
 *  1. Read `transactions_cleared_at` (the admin cutoff)
 *  2. Drop local rows that are gone from the cloud (already-synced copies)
 *  3. Drop unsynced local rows created at or before the cutoff
 *  4. Skip pushing those rows so test history cannot come back
 */

import { db, type LocalStore } from './dexie';
import { isSupabaseConfigured, supabase } from './supabase';

export interface StoreLedgerClearCounts {
  transactions: number;
  items: number;
  expenses: number;
  cashBook: number;
}

function toMillis(iso: string | undefined): number {
  if (!iso) return Number.NaN;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

export function ledgerCreatedAtOrBefore(
  createdAt: string | undefined,
  clearedAt: string | null | undefined
): boolean {
  if (!clearedAt) return false;
  if (!createdAt) return true;
  const createdMs = toMillis(createdAt);
  const clearedMs = toMillis(clearedAt);
  if (Number.isNaN(clearedMs)) return createdAt <= clearedAt;
  if (Number.isNaN(createdMs)) return true;
  return createdMs <= clearedMs;
}

function readClearedAt(store: LocalStore | undefined): string | null {
  return store?.transactions_cleared_at ? String(store.transactions_cleared_at) : null;
}

async function fetchStoreRowIds(table: string, storeId: string): Promise<Set<string> | null> {
  const ids = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('store_id', storeId)
      .range(from, from + pageSize - 1);
    if (error) return null;
    const rows = data || [];
    for (const row of rows) {
      if (row?.id) ids.add(String(row.id));
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from >= 50_000) break;
  }
  return ids;
}

async function stampLocalClearedAt(storeId: string, clearedAt: string): Promise<void> {
  const store = await db.stores.get(storeId);
  if (!store) return;
  const current = readClearedAt(store);
  const currentMs = toMillis(current || undefined);
  const nextMs = toMillis(clearedAt);
  if (current && !Number.isNaN(currentMs) && !Number.isNaN(nextMs) && currentMs >= nextMs) {
    return;
  }
  if (current && current >= clearedAt && Number.isNaN(currentMs)) return;
  await db.stores.put({
    ...store,
    transactions_cleared_at: clearedAt,
  });
}

/** Drop local sales/report rows created at or before the admin wipe. Idempotent. */
export async function applyLocalStoreLedgerClear(
  storeId: string,
  clearedAt: string
): Promise<StoreLedgerClearCounts> {
  const [txns, items, expenses, cashBook, creditPayments] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.expenses.where('store_id').equals(storeId).toArray(),
    db.cash_book_entries.where('store_id').equals(storeId).toArray(),
    db.credit_payments.where('store_id').equals(storeId).toArray(),
  ]);

  const keepTxnIds = new Set(
    txns.filter((t) => !ledgerCreatedAtOrBefore(t.created_at, clearedAt)).map((t) => t.id)
  );
  const txnsToDelete = txns.filter((t) => !keepTxnIds.has(t.id));
  const itemsToDelete = items.filter((i) => !keepTxnIds.has(i.transaction_id));
  const expensesToDelete = expenses.filter((e) => ledgerCreatedAtOrBefore(e.created_at, clearedAt));
  const cashToDelete = cashBook.filter((e) => ledgerCreatedAtOrBefore(e.created_at, clearedAt));
  const creditPaymentsToDelete = creditPayments.filter((payment) =>
    !keepTxnIds.has(payment.transaction_id) || ledgerCreatedAtOrBefore(payment.created_at, clearedAt)
  );

  await db.transaction(
    'rw',
    [db.transactions, db.transaction_items, db.credit_payments, db.expenses, db.cash_book_entries, db.stores],
    async () => {
      await Promise.all(itemsToDelete.map((i) => db.transaction_items.delete(i.id)));
      await Promise.all(creditPaymentsToDelete.map((payment) => db.credit_payments.delete(payment.id)));
      await Promise.all(txnsToDelete.map((t) => db.transactions.delete(t.id)));
      await Promise.all(expensesToDelete.map((e) => db.expenses.delete(e.id)));
      await Promise.all(cashToDelete.map((e) => db.cash_book_entries.delete(e.id)));
      await stampLocalClearedAt(storeId, clearedAt);
    }
  );

  return {
    transactions: txnsToDelete.length,
    items: itemsToDelete.length,
    expenses: expensesToDelete.length,
    cashBook: cashToDelete.length,
  };
}

function shouldKeepLocalLedgerRow(
  id: string,
  createdAt: string | undefined,
  synced: number | undefined,
  remoteIds: Set<string> | null,
  clearedAt: string | null
): boolean {
  if (ledgerCreatedAtOrBefore(createdAt, clearedAt)) return false;
  if (remoteIds && remoteIds.has(id)) return true;
  // Already-synced copy that the admin (or another device) removed from cloud
  if (synced === 1 && remoteIds && !remoteIds.has(id)) return false;
  // Unsynced local sale made after the wipe — keep and push
  return true;
}

async function dropLocalLedgerNotInCloud(
  storeId: string,
  clearedAt: string | null
): Promise<StoreLedgerClearCounts> {
  const [remoteTxnIds, remoteExpenseIds, remoteCashIds, remoteCreditPaymentIds] = await Promise.all([
    fetchStoreRowIds('transactions', storeId),
    fetchStoreRowIds('expenses', storeId),
    fetchStoreRowIds('cash_book_entries', storeId),
    fetchStoreRowIds('credit_payments', storeId),
  ]);

  const [txns, items, expenses, cashBook, creditPayments] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.expenses.where('store_id').equals(storeId).toArray(),
    db.cash_book_entries.where('store_id').equals(storeId).toArray(),
    db.credit_payments.where('store_id').equals(storeId).toArray(),
  ]);

  const keepTxnIds = new Set(
    txns
      .filter((t) => shouldKeepLocalLedgerRow(t.id, t.created_at, t.synced, remoteTxnIds, clearedAt))
      .map((t) => t.id)
  );
  const txnsToDelete = txns.filter((t) => !keepTxnIds.has(t.id));
  const itemsToDelete = items.filter((i) => !keepTxnIds.has(i.transaction_id));
  const expensesToDelete = expenses.filter(
    (e) => !shouldKeepLocalLedgerRow(e.id, e.created_at, e.synced, remoteExpenseIds, clearedAt)
  );
  const cashToDelete = cashBook.filter(
    (e) => !shouldKeepLocalLedgerRow(e.id, e.created_at, e.synced, remoteCashIds, clearedAt)
  );
  const creditPaymentsToDelete = creditPayments.filter((payment) =>
    !keepTxnIds.has(payment.transaction_id) ||
    !shouldKeepLocalLedgerRow(payment.id, payment.created_at, payment.synced, remoteCreditPaymentIds, clearedAt)
  );

  await db.transaction(
    'rw',
    [db.transactions, db.transaction_items, db.credit_payments, db.expenses, db.cash_book_entries],
    async () => {
      await Promise.all(itemsToDelete.map((i) => db.transaction_items.delete(i.id)));
      await Promise.all(creditPaymentsToDelete.map((payment) => db.credit_payments.delete(payment.id)));
      await Promise.all(txnsToDelete.map((t) => db.transactions.delete(t.id)));
      await Promise.all(expensesToDelete.map((e) => db.expenses.delete(e.id)));
      await Promise.all(cashToDelete.map((e) => db.cash_book_entries.delete(e.id)));
    }
  );

  return {
    transactions: txnsToDelete.length,
    items: itemsToDelete.length,
    expenses: expensesToDelete.length,
    cashBook: cashToDelete.length,
  };
}

async function readRemoteClearedAt(storeId: string): Promise<string | null> {
  const column = await supabase
    .from('stores')
    .select('transactions_cleared_at')
    .eq('id', storeId)
    .maybeSingle();

  if (!column.error && column.data?.transactions_cleared_at) {
    return String(column.data.transactions_cleared_at);
  }

  // Schema cache / older select lists: fall back to the full store row
  const full = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
  if (full.data && (full.data as { transactions_cleared_at?: string }).transactions_cleared_at) {
    return String((full.data as { transactions_cleared_at: string }).transactions_cleared_at);
  }
  return null;
}

/**
 * Match this device to the cloud sales ledger before push/pull.
 * Removes leftover trial sales even when `transactions_cleared_at` cannot be read.
 */
export async function refreshRemoteLedgerClearAndApply(storeId: string): Promise<{
  clearedAt: string | null;
  dropped: StoreLedgerClearCounts;
}> {
  const empty: StoreLedgerClearCounts = { transactions: 0, items: 0, expenses: 0, cashBook: 0 };
  const local = await db.stores.get(storeId);
  const localClearedAt = readClearedAt(local);
  let remoteClearedAt: string | null = null;

  if (isSupabaseConfigured()) {
    remoteClearedAt = await readRemoteClearedAt(storeId);
  }

  let clearedAt = remoteClearedAt || localClearedAt;
  if (remoteClearedAt && localClearedAt) {
    const remoteMs = toMillis(remoteClearedAt);
    const localMs = toMillis(localClearedAt);
    if (!Number.isNaN(remoteMs) && !Number.isNaN(localMs)) {
      clearedAt = remoteMs >= localMs ? remoteClearedAt : localClearedAt;
    }
  }

  let dropped = empty;
  if (clearedAt) {
    dropped = await applyLocalStoreLedgerClear(storeId, clearedAt);
  }

  if (isSupabaseConfigured()) {
    const missing = await dropLocalLedgerNotInCloud(storeId, clearedAt);
    dropped = {
      transactions: dropped.transactions + missing.transactions,
      items: dropped.items + missing.items,
      expenses: dropped.expenses + missing.expenses,
      cashBook: dropped.cashBook + missing.cashBook,
    };
  }

  return { clearedAt, dropped };
}

export function shouldPushLedgerRow(
  createdAt: string | undefined,
  clearedAt: string | null | undefined
): boolean {
  return !ledgerCreatedAtOrBefore(createdAt, clearedAt);
}

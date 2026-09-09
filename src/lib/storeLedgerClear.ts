/**
 * Super-admin wipe of a store's trial sales ledger.
 *
 * Cloud delete is not enough on its own: devices still hold IndexedDB rows
 * and would re-upload them on the next push. `transactions_cleared_at` on the
 * store is the cutoff. Local rows created at or before that timestamp are
 * dropped, and push skips them so test history cannot come back.
 */

import { db, type LocalStore } from './dexie';
import { isSupabaseConfigured, supabase } from './supabase';

export interface StoreLedgerClearCounts {
  transactions: number;
  items: number;
  expenses: number;
  cashBook: number;
}

export function ledgerCreatedAtOrBefore(
  createdAt: string | undefined,
  clearedAt: string | null | undefined
): boolean {
  if (!clearedAt) return false;
  if (!createdAt) return true;
  return createdAt <= clearedAt;
}

function readClearedAt(store: LocalStore | undefined): string | null {
  return store?.transactions_cleared_at ? String(store.transactions_cleared_at) : null;
}

/** Drop local sales/report rows created at or before the admin wipe. Idempotent. */
export async function applyLocalStoreLedgerClear(
  storeId: string,
  clearedAt: string
): Promise<StoreLedgerClearCounts> {
  const [txns, items, expenses, cashBook] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.expenses.where('store_id').equals(storeId).toArray(),
    db.cash_book_entries.where('store_id').equals(storeId).toArray(),
  ]);

  const keepTxnIds = new Set(
    txns.filter((t) => !ledgerCreatedAtOrBefore(t.created_at, clearedAt)).map((t) => t.id)
  );
  const txnsToDelete = txns.filter((t) => !keepTxnIds.has(t.id));
  const itemsToDelete = items.filter((i) => !keepTxnIds.has(i.transaction_id));
  const expensesToDelete = expenses.filter((e) => ledgerCreatedAtOrBefore(e.created_at, clearedAt));
  const cashToDelete = cashBook.filter((e) => ledgerCreatedAtOrBefore(e.created_at, clearedAt));

  await db.transaction(
    'rw',
    [db.transactions, db.transaction_items, db.expenses, db.cash_book_entries, db.stores],
    async () => {
      await Promise.all(itemsToDelete.map((i) => db.transaction_items.delete(i.id)));
      await Promise.all(txnsToDelete.map((t) => db.transactions.delete(t.id)));
      await Promise.all(expensesToDelete.map((e) => db.expenses.delete(e.id)));
      await Promise.all(cashToDelete.map((e) => db.cash_book_entries.delete(e.id)));
      const store = await db.stores.get(storeId);
      if (store) {
        const current = readClearedAt(store);
        if (!current || current < clearedAt) {
          await db.stores.put({
            ...store,
            transactions_cleared_at: clearedAt,
          });
        }
      }
    }
  );

  return {
    transactions: txnsToDelete.length,
    items: itemsToDelete.length,
    expenses: expensesToDelete.length,
    cashBook: cashToDelete.length,
  };
}

/**
 * Read the cloud cutoff and apply it locally before push/pull.
 * Missing column (migration not run) is treated as "no wipe".
 */
export async function refreshRemoteLedgerClearAndApply(storeId: string): Promise<string | null> {
  const local = await db.stores.get(storeId);
  const localClearedAt = readClearedAt(local);

  if (!isSupabaseConfigured()) {
    if (localClearedAt) await applyLocalStoreLedgerClear(storeId, localClearedAt);
    return localClearedAt;
  }

  const { data, error } = await supabase
    .from('stores')
    .select('transactions_cleared_at')
    .eq('id', storeId)
    .maybeSingle();

  if (error) {
    if (localClearedAt) await applyLocalStoreLedgerClear(storeId, localClearedAt);
    return localClearedAt;
  }

  const remoteClearedAt = data?.transactions_cleared_at ? String(data.transactions_cleared_at) : null;
  const clearedAt =
    remoteClearedAt && localClearedAt
      ? remoteClearedAt >= localClearedAt
        ? remoteClearedAt
        : localClearedAt
      : remoteClearedAt || localClearedAt;

  if (clearedAt) await applyLocalStoreLedgerClear(storeId, clearedAt);
  return clearedAt;
}

export function shouldPushLedgerRow(
  createdAt: string | undefined,
  clearedAt: string | null | undefined
): boolean {
  return !ledgerCreatedAtOrBefore(createdAt, clearedAt);
}

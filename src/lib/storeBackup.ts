import { db } from '@/lib/dexie';

const BACKUP_TABLES = [
  'users',
  'products',
  'product_categories',
  'customers',
  'customer_opening_payments',
  'customer_account_receipts',
  'transactions',
  'transaction_items',
  'credit_payments',
  'sales_returns',
  'customer_wallet_transactions',
  'expenses',
  'recurring_expenses',
  'expense_budgets',
  'cash_book_entries',
  'locations',
  'stock_batches',
  'stock_movements',
  'online_orders',
  'online_order_items',
  'suppliers',
  'purchase_orders',
  'deleted_records',
] as const;
const MAX_BACKUP_SIZE_BYTES = 50 * 1024 * 1024;

type BackupPayload = {
  format: 'adimat-store-backup';
  version: 1;
  created_at: string;
  store_id: string;
  store: Record<string, unknown>;
  tables: Record<(typeof BACKUP_TABLES)[number], Record<string, unknown>[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function recordBackupIssue(message: string): void {
  try {
    if (message) localStorage.setItem('adimat_backup_error', message);
    else localStorage.removeItem('adimat_backup_error');
  } catch (error) {
    console.error('[Backup] Could not persist backup status:', error);
  }
}

async function buildBackup(storeId: string): Promise<BackupPayload> {
  const store = await db.stores.get(storeId);
  if (!store) throw new Error('The selected store is not available on this device.');
  const tables = {} as BackupPayload['tables'];
  for (const name of BACKUP_TABLES) {
    const rows = await db.table(name).where('store_id').equals(storeId).toArray();
    tables[name] = rows as Record<string, unknown>[];
  }
  return {
    format: 'adimat-store-backup',
    version: 1,
    created_at: new Date().toISOString(),
    store_id: storeId,
    store: store as unknown as Record<string, unknown>,
    tables,
  };
}

function serializeBackup(backup: BackupPayload): string {
  const data = JSON.stringify(backup, null, 2);
  if (new Blob([data]).size > MAX_BACKUP_SIZE_BYTES) {
    throw new Error('This store backup exceeds the 50 MB limit. Reduce stored image/data sizes before exporting.');
  }
  return data;
}

export async function exportStoreBackup(storeId: string): Promise<Blob> {
  const backup = await buildBackup(storeId);
  return new Blob([serializeBackup(backup)], { type: 'application/json' });
}

export async function createAutomaticStoreBackup(storeId: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const latest = await db.backup_snapshots.where('store_id').equals(storeId).toArray();
  latest.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (latest[0]?.created_at.slice(0, 10) === today) return null;
  const backup = await buildBackup(storeId);
  const dataJson = serializeBackup(backup);
  const createdAt = new Date().toISOString();
  try {
    await db.backup_snapshots.add({
      id: `${storeId}:${today}`,
      store_id: storeId,
      created_at: createdAt,
      data_json: dataJson,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError' && await db.backup_snapshots.get(`${storeId}:${today}`)) {
      return null;
    }
    throw error;
  }
  const snapshots = await db.backup_snapshots.where('store_id').equals(storeId).toArray();
  snapshots.sort((a, b) => b.created_at.localeCompare(a.created_at));
  await Promise.all(snapshots.slice(7).map((snapshot) => db.backup_snapshots.delete(snapshot.id)));
  return createdAt;
}

export async function getLatestAutomaticBackup(storeId: string) {
  const snapshots = await db.backup_snapshots.where('store_id').equals(storeId).toArray();
  snapshots.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return snapshots[0] || null;
}

export async function exportLatestAutomaticBackup(storeId: string): Promise<Blob> {
  const snapshot = await getLatestAutomaticBackup(storeId);
  if (!snapshot) throw new Error('No automatic backup exists on this device yet.');
  return new Blob([snapshot.data_json], { type: 'application/json' });
}

export async function restoreStoreBackup(file: File, currentStoreId: string): Promise<void> {
  if (file.size > MAX_BACKUP_SIZE_BYTES) throw new Error('Backup file is larger than 50 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== 'adimat-store-backup' || parsed.version !== 1) {
    throw new Error('This is not a supported Adimat store backup.');
  }
  if (parsed.store_id !== currentStoreId || !isRecord(parsed.store) || parsed.store.id !== currentStoreId) {
    throw new Error('This backup belongs to a different store. Switch to that store before restoring it.');
  }
  if (!isRecord(parsed.tables)) throw new Error('The backup is missing its store data.');

  const tables = {} as BackupPayload['tables'];
  for (const name of BACKUP_TABLES) {
    const rows = parsed.tables[name] ??
      (name === 'product_categories' ||
      name === 'customers' ||
      name === 'customer_opening_payments' ||
      name === 'customer_account_receipts' ||
      name === 'credit_payments' ||
      name === 'sales_returns' ||
      name === 'customer_wallet_transactions' ? [] : undefined);
    if (!Array.isArray(rows) || !rows.every((row) => isRecord(row) && row.store_id === currentStoreId)) {
      throw new Error(`The backup contains invalid ${name} records.`);
    }
    tables[name] = rows as Record<string, unknown>[];
  }
  if (!tables.users.some((user) => user.role === 'owner' && user.is_active === 1)) {
    throw new Error('The backup must contain an active store owner account.');
  }

  const importedStore = parsed.store as unknown as Parameters<typeof db.stores.put>[0];
  const allTables = [db.stores, db.sync_meta, ...BACKUP_TABLES.map((name) => db.table(name))];
  await db.transaction('rw', allTables, async () => {
    for (const name of BACKUP_TABLES) {
      await db.table(name).where('store_id').equals(currentStoreId).delete();
      const rows = tables[name];
      if (rows.length > 0) await db.table(name).bulkPut(rows);
    }
    await db.stores.put(importedStore);
    await db.sync_meta.delete('last_sync');
  });
}

export async function getStoreSyncHealth(storeId: string) {
  const syncable = [
    db.users, db.products, db.product_categories, db.customers, db.customer_opening_payments,
    db.transactions, db.transaction_items, db.credit_payments, db.customer_account_receipts,
    db.sales_returns, db.customer_wallet_transactions, db.expenses,
    db.recurring_expenses, db.expense_budgets,
    db.cash_book_entries, db.locations, db.stock_batches, db.stock_movements,
    db.online_orders, db.online_order_items, db.suppliers, db.purchase_orders,
  ];
  const pendingRows = await Promise.all(syncable.map(async (table) => {
    const rows = await table.where('store_id').equals(storeId).toArray();
    return rows.filter((row) => (row as { synced?: number }).synced === 0).length;
  }));
  const store = await db.stores.get(storeId);
  return {
    pendingCount: pendingRows.reduce((total, count) => total + count, 0) + (store?.synced === 0 ? 1 : 0),
    lastSyncAt: (await db.sync_meta.get('last_sync'))?.last_synced_at || null,
    lastError: localStorage.getItem('adimat_last_sync_error') || '',
    backupError: localStorage.getItem('adimat_backup_error') || '',
    online: typeof navigator === 'undefined' || navigator.onLine,
  };
}

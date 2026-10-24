import { db } from './dexie';
import { nextRetryDelayMs } from './syncConflict';
import type { LocalSyncOutbox } from './syncTypes';

const FINANCIAL_TABLES = new Set([
  'transactions',
  'transaction_items',
  'credit_payments',
  'customer_opening_payments',
  'customer_account_receipts',
  'customer_wallet_transactions',
  'sales_returns',
  'stock_movements',
  'stock_batches',
  'support_tickets',
  'support_messages',
]);

const CHANNEL_NAME = 'adimat-sync';
let hooksInstalled = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let bus: BroadcastChannel | null = null;

export function installSyncBroadcast(onMessage: (data: unknown) => void): void {
  if (typeof BroadcastChannel === 'undefined' || bus) return;
  bus = new BroadcastChannel(CHANNEL_NAME);
  bus.addEventListener('message', (event) => onMessage(event.data));
}

export function publishSync(detail: Record<string, unknown>): void {
  try {
    bus?.postMessage(detail);
  } catch {
    // A closed channel must not block the sync that already finished.
  }
}

export function scheduleDebouncedPush(run: () => void, delayMs = 1000): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    run();
  }, delayMs);
}

export function installLocalWriteHooks(onLocalWrite: () => void): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const tables = [
    'products',
    'transactions',
    'transaction_items',
    'stock_batches',
    'stock_movements',
    'customers',
    'expenses',
    'credit_payments',
    'sales_returns',
    'customer_wallet_transactions',
    'support_tickets',
    'support_messages',
    'purchase_orders',
    'online_orders',
  ];
  for (const name of tables) {
    const table = db.table(name);
    table.hook('creating', (key, obj) => {
      const row = obj as { id?: string; store_id?: string; synced?: number };
      note(name, String(row.id || key || ''), row.store_id || '', row.synced, onLocalWrite);
    });
    table.hook('updating', (mods, key) => {
      const changes = mods as { synced?: number; store_id?: string };
      if (changes.synced === 0) note(name, String(key), changes.store_id || '', 0, onLocalWrite);
    });
  }
}

function note(table: string, id: string, storeId: string, synced: number | undefined, onLocalWrite: () => void): void {
  if (synced !== 0 || !id) return;
  setTimeout(() => {
    void rememberOutbox(table, id, storeId);
    onLocalWrite();
  }, 0);
}

async function rememberOutbox(table: string, id: string, storeId: string): Promise<void> {
  if (!FINANCIAL_TABLES.has(table)) return;
  const existing = await db.sync_outbox.get(id);
  if (existing) return;
  let resolvedStore = storeId;
  if (!resolvedStore) {
    const row = await db.table(table).get(id) as { store_id?: string } | undefined;
    resolvedStore = row?.store_id || '';
  }
  const entry: LocalSyncOutbox = {
    id,
    store_id: resolvedStore,
    table_name: table,
    record_id: id,
    attempts: 0,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
    last_error: '',
    created_at: new Date().toISOString(),
  };
  await db.sync_outbox.put(entry);
}

export async function countPendingChanges(storeId: string | null): Promise<number> {
  if (!storeId) return db.sync_outbox.where('status').equals('pending').count();
  const rows = await db.sync_outbox.where('store_id').equals(storeId).toArray();
  return rows.filter((row) => row.status === 'pending').length;
}

export async function outboxReady(now = Date.now()): Promise<boolean> {
  const pending = await db.sync_outbox.where('status').equals('pending').toArray();
  if (pending.length === 0) return true;
  return pending.some((row) => Date.parse(row.next_attempt_at) <= now);
}

export async function bumpOutboxFailures(message: string): Promise<void> {
  const pending = await db.sync_outbox.where('status').equals('pending').toArray();
  const now = Date.now();
  await Promise.all(pending.map((row) => {
    const attempts = row.attempts + 1;
    return db.sync_outbox.update(row.id, {
      attempts,
      status: attempts >= 8 ? 'error' : 'pending',
      last_error: message.slice(0, 300),
      next_attempt_at: new Date(now + nextRetryDelayMs(attempts)).toISOString(),
    });
  }));
}

export async function completeOutboxForSyncedRows(): Promise<void> {
  const pending = await db.sync_outbox.where('status').equals('pending').toArray();
  await Promise.all(pending.map(async (row) => {
    const record = await db.table(row.table_name).get(row.record_id) as { synced?: number } | undefined;
    if (record && record.synced === 1) {
      await db.sync_outbox.update(row.id, { status: 'done', last_error: '' });
    }
  }));
}

export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const syncManager = (window as Window & { SyncManager?: unknown }).SyncManager;
  if (!syncManager) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
    if (sync) await sync.register('adimat-sync');
  } catch {
    // iOS Safari has no Background Sync. Online and visibility events cover that path.
  }
}

const FULL_PULL_PREFIX = 'adimat_full_pull_done:';

export function needsFullPull(storeId: string): boolean {
  try {
    return localStorage.getItem(`${FULL_PULL_PREFIX}${storeId}`) !== '1';
  } catch {
    return false;
  }
}

export function markFullPullDone(storeId: string): void {
  try {
    localStorage.setItem(`${FULL_PULL_PREFIX}${storeId}`, '1');
  } catch {
    // Ignore private-mode storage failures. The next launch will pull again.
  }
}

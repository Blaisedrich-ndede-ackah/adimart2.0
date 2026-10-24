import { isSupabaseConfigured, supabase } from './supabase';
import { syncBidirectional, syncFromSupabase, syncStockFast, syncToSupabase, refreshStockFromCloud, getCurrentStoreId } from './dexie';
import { pullSupportChanges } from './support/cloud';
import {
  bumpOutboxFailures,
  completeOutboxForSyncedRows,
  countPendingChanges,
  installLocalWriteHooks,
  installSyncBroadcast,
  markFullPullDone,
  needsFullPull,
  outboxReady,
  publishSync,
  registerBackgroundSync,
  scheduleDebouncedPush,
} from './syncEngine';

const AUTO_SYNC_KEY = 'adimat_auto_sync';
const LAST_SYNC_ERROR_KEY = 'adimat_last_sync_error';
const LIVE_DEBOUNCE_MS = 1000;
const PUSH_DEBOUNCE_MS = 1000;

const LIVE_TABLES = [
  'products',
  'stock_batches',
  'stock_movements',
  'transactions',
  'transaction_items',
  'customers',
  'expenses',
  'sales_returns',
  'customer_wallet_transactions',
  'credit_payments',
  'purchase_orders',
  'suppliers',
  'online_orders',
  'online_order_items',
  'locations',
  'cash_book_entries',
  'support_tickets',
  'support_messages',
  'customer_account_receipts',
  'customer_opening_payments',
  'bulk_sms_campaigns',
  'debt_reminders',
] as const;

let syncInProgress = false;
let syncQueued = false;
let queuedReason = 'queued';
let liveChannel: ReturnType<typeof supabase.channel> | null = null;
let liveDebounce: ReturnType<typeof setTimeout> | null = null;
let hooksReady = false;

export function isAutoSyncEnabled(): boolean {
  return localStorage.getItem(AUTO_SYNC_KEY) !== 'false';
}

export function setAutoSyncEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_SYNC_KEY, enabled ? 'true' : 'false');
  if (enabled) startAutoSync();
  else stopAutoSync();
}

function dispatchSyncEvent(phase: 'start' | 'complete' | 'error', detail: Record<string, unknown>): void {
  const payload = { phase, ...detail };
  try {
    window.dispatchEvent(new CustomEvent('adimat-sync', { detail: payload }));
  } catch {
    // Event delivery must not fail the sync itself.
  }
  publishSync(payload);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function publishPending(): Promise<void> {
  try {
    const storeId = await getCurrentStoreId();
    const count = await countPendingChanges(storeId);
    window.dispatchEvent(new CustomEvent('adimat-sync-pending', { detail: { count } }));
    publishSync({ phase: 'pending', count });
  } catch {
    // Pending count is a status hint only.
  }
}

export function recordSyncOutcome(result: { success: boolean; message: string }): void {
  try {
    if (result.success) localStorage.removeItem(LAST_SYNC_ERROR_KEY);
    else localStorage.setItem(LAST_SYNC_ERROR_KEY, result.message);
  } catch (error) {
    console.error('[Sync] Could not persist sync health status:', error);
  }
}

async function runSync(reason: string, work: () => Promise<{ success: boolean; message: string }>): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) {
    await publishPending();
    return;
  }
  if (!isOnline()) {
    await publishPending();
    return;
  }
  if (reason !== 'manual' && reason !== 'online' && reason !== 'first-login' && !(await outboxReady())) {
    await publishPending();
    return;
  }
  if (syncInProgress) {
    syncQueued = true;
    queuedReason = reason;
    return;
  }
  syncInProgress = true;
  dispatchSyncEvent('start', { reason });
  try {
    const result = await work();
    recordSyncOutcome(result);
    if (result.success) await completeOutboxForSyncedRows();
    else await bumpOutboxFailures(result.message);
    dispatchSyncEvent(result.success ? 'complete' : 'error', {
      success: result.success,
      message: result.message,
      reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordSyncOutcome({ success: false, message });
    await bumpOutboxFailures(message);
    dispatchSyncEvent('error', { success: false, message, reason });
  } finally {
    syncInProgress = false;
    await publishPending();
    if (syncQueued) {
      syncQueued = false;
      const next = queuedReason;
      queuedReason = 'queued';
      void runSync(next, () => syncBidirectional());
    }
  }
}

export async function triggerAutoSync(reason = 'auto'): Promise<void> {
  await runSync(reason, async () => {
    const result = await syncStockFast();
    const storeId = await getCurrentStoreId();
    if (storeId) await pullSupportChanges(storeId);
    return result;
  });
}

/** Push local changes. Calls from the app are coalesced to about one second. */
export function triggerPushSync(reason = 'push'): Promise<void> {
  return new Promise((resolve) => {
    scheduleDebouncedPush(() => {
      void runSync(reason, () => syncToSupabase({ skipPing: true, skipCanonicalize: true })).then(resolve);
    }, PUSH_DEBOUNCE_MS);
  });
}

export async function triggerReconnectSync(reason = 'online'): Promise<void> {
  await runSync(reason, () => syncBidirectional());
}

export async function triggerPullSync(reason = 'live'): Promise<void> {
  await runSync(reason, async () => {
    const pull = await syncFromSupabase({ skipCatalogAlign: true });
    const stock = await refreshStockFromCloud();
    const storeId = await getCurrentStoreId();
    if (storeId) await pullSupportChanges(storeId);
    if (!pull.success) return { success: false, message: pull.message };
    if (!stock.ok) return { success: false, message: stock.message || pull.message };
    return { success: true, message: pull.message };
  });
}

export async function syncNow(): Promise<void> {
  await triggerReconnectSync('manual');
}

function scheduleLivePull(): void {
  if (liveDebounce) clearTimeout(liveDebounce);
  liveDebounce = setTimeout(() => {
    liveDebounce = null;
    void triggerPullSync('live');
  }, LIVE_DEBOUNCE_MS);
}

export function startLiveStockSync(storeId: string): () => void {
  stopLiveStockSync();
  if (!isSupabaseConfigured() || !storeId) return () => undefined;
  let channel = supabase.channel(`adimat-live-${storeId}`);
  for (const table of LIVE_TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `store_id=eq.${storeId}` },
      () => scheduleLivePull()
    );
  }
  liveChannel = channel.subscribe();
  return stopLiveStockSync;
}

export function stopLiveStockSync(): void {
  if (liveChannel) {
    void supabase.removeChannel(liveChannel);
    liveChannel = null;
  }
}

export function startAutoSync(): void {
  stopAutoSync();
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  window.addEventListener('online', handleOnline);
  window.addEventListener('focus', handleVisible);
  document.addEventListener('visibilitychange', handleVisible);
  window.addEventListener('adimat-background-sync', handleOnline);
}

export function stopAutoSync(): void {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('focus', handleVisible);
  document.removeEventListener('visibilitychange', handleVisible);
  window.removeEventListener('adimat-background-sync', handleOnline);
  stopLiveStockSync();
}

function handleOnline(): void {
  void triggerReconnectSync('online');
}

function handleVisible(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!isOnline()) return;
  void triggerReconnectSync('visible');
}

export function initAutoSync(): void {
  if (!hooksReady) {
    hooksReady = true;
    installLocalWriteHooks(() => {
      void publishPending();
      void triggerPushSync('write');
    });
    installSyncBroadcast((data) => {
      const detail = data as { phase?: string; count?: number };
      if (!detail?.phase || detail.phase === 'pending') {
        if (typeof detail?.count === 'number') {
          window.dispatchEvent(new CustomEvent('adimat-sync-pending', { detail: { count: detail.count } }));
        }
        return;
      }
      window.dispatchEvent(new CustomEvent('adimat-sync', { detail }));
    });
    void registerBackgroundSync();
    navigator.serviceWorker?.addEventListener('message', (event) => {
      const data = event.data as { type?: string } | undefined;
      if (data?.type === 'adimat-background-sync') {
        window.dispatchEvent(new Event('adimat-background-sync'));
      }
    });
  }
  void publishPending();
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  startAutoSync();
  void triggerReconnectSync('startup');
}

export async function ensureFirstFullPull(storeId: string): Promise<void> {
  if (!storeId || !needsFullPull(storeId)) return;
  if (!isOnline() || !isSupabaseConfigured()) return;
  await triggerReconnectSync('first-login');
  markFullPullDone(storeId);
}

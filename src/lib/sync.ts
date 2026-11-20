import { isSupabaseConfigured, supabase } from './supabase';
import { FAST_SYNC_TABLES, syncStockFast, syncToSupabase } from './dexie';

const AUTO_SYNC_KEY = 'adimat_auto_sync';
const LAST_SYNC_ERROR_KEY = 'adimat_last_sync_error';
const AUTO_SYNC_INTERVAL_MS = 60 * 1000;
const LIVE_DEBOUNCE_MS = 600;
const MIN_ONLINE_GAP_MS = 30_000;

let syncInProgress = false;
let syncQueued = false;
let syncQueuedAllTables = false;
const syncQueuedTables = new Set<string>();
let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastAutoSyncAt = 0;
let liveChannel: ReturnType<typeof supabase.channel> | null = null;
let lastOnlineSyncAt = 0;
let liveCooldownTimer: ReturnType<typeof setTimeout> | null = null;

export function isAutoSyncEnabled(): boolean {
  return localStorage.getItem(AUTO_SYNC_KEY) !== 'false';
}

export function setAutoSyncEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_SYNC_KEY, enabled ? 'true' : 'false');
  if (enabled) {
    startAutoSync();
  } else {
    stopAutoSync();
  }
}

let liveDebounce: ReturnType<typeof setTimeout> | null = null;
const liveTables = new Set<string>();

function scheduleQueuedSync(delayMs: number): void {
  if (liveCooldownTimer) return;
  liveCooldownTimer = setTimeout(() => {
    liveCooldownTimer = null;
    const nextTables = syncQueuedAllTables ? undefined : [...syncQueuedTables];
    syncQueued = false;
    syncQueuedAllTables = false;
    syncQueuedTables.clear();
    void triggerAutoSync(nextTables ? 'live' : 'queued', nextTables);
  }, delayMs);
}

function dispatchSyncEvent(phase: 'start' | 'complete' | 'error', detail: Record<string, unknown>): void {
  try {
    window.dispatchEvent(new CustomEvent('adimat-sync', { detail: { phase, ...detail } }));
  } catch {
    // Swallow dispatch errors so sync never fails because of event delivery.
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function withCrossTabSyncLock(task: () => Promise<void>): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    await task();
    return true;
  }

  let acquired = false;
  await navigator.locks.request('adimat-cloud-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    acquired = true;
    await task();
  });
  return acquired;
}

export async function triggerAutoSync(reason = 'auto', onlyTables?: string[]): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  if ((reason === 'online' || reason === 'focus' || reason === 'visible') && !isOnline()) return;
  if (syncInProgress) {
    syncQueued = true;
    if (onlyTables) onlyTables.forEach((table) => syncQueuedTables.add(table));
    else syncQueuedAllTables = true;
    return;
  }

  const now = Date.now();
  if ((reason === 'auto' || reason === 'interval' || reason === 'live') && now - lastAutoSyncAt < 8_000) {
    if (reason === 'live') {
      syncQueued = true;
      if (onlyTables) onlyTables.forEach((table) => syncQueuedTables.add(table));
      else syncQueuedAllTables = true;
      scheduleQueuedSync(8_000 - (now - lastAutoSyncAt));
    }
    return;
  }

  if (reason === 'online') {
    if (now - lastOnlineSyncAt < MIN_ONLINE_GAP_MS) return;
    lastOnlineSyncAt = now;
  }

  syncInProgress = true;
  try {
    const acquired = await withCrossTabSyncLock(async () => {
      dispatchSyncEvent('start', { reason });
      const livePull = onlyTables !== undefined;
      const refreshStock = !livePull || onlyTables.some((table) =>
        table === 'stock_batches' || table === 'locations'
      );
      const pullTables = onlyTables?.filter((table) => table !== 'stock_batches');
      const result = await syncStockFast(livePull
        ? {
          tables: pullTables,
          push: false,
          refreshStock,
          forceStockRefresh: refreshStock,
        }
        : undefined);
      recordSyncOutcome(result);
      lastAutoSyncAt = Date.now();
      dispatchSyncEvent('complete', {
        success: result.success,
        message: result.message,
        reason,
      });
    });
    if (!acquired) {
      dispatchSyncEvent('complete', {
        success: true,
        message: 'Another tab is synchronizing this device.',
        reason,
        skipped: true,
      });
    }
  } catch (error) {
    recordSyncOutcome({ success: false, message: error instanceof Error ? error.message : String(error) });
    dispatchSyncEvent('error', {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      reason,
    });
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      const nextTables = syncQueuedAllTables ? undefined : [...syncQueuedTables];
      const nextReason = nextTables ? 'live' : 'queued';
      syncQueued = false;
      syncQueuedAllTables = false;
      syncQueuedTables.clear();
      void triggerAutoSync(nextReason, nextTables);
    }
  }
}

/** Push local changes only — much faster after checkout / order fulfill. */
export async function triggerPushSync(reason = 'push'): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  if (!isOnline()) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  syncInProgress = true;
  try {
    const acquired = await withCrossTabSyncLock(async () => {
      dispatchSyncEvent('start', { reason });
      const result = await syncToSupabase();
      recordSyncOutcome(result);
      lastAutoSyncAt = Date.now();
      dispatchSyncEvent('complete', {
        success: result.success,
        message: result.message,
        reason,
      });
    });
    if (!acquired) {
      dispatchSyncEvent('complete', {
        success: true,
        message: 'Another tab is synchronizing this device.',
        reason,
        skipped: true,
      });
    }
  } catch (error) {
    recordSyncOutcome({ success: false, message: error instanceof Error ? error.message : String(error) });
    dispatchSyncEvent('error', {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      reason,
    });
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      const nextTables = syncQueuedAllTables ? undefined : [...syncQueuedTables];
      const nextReason = nextTables ? 'live' : 'queued';
      syncQueued = false;
      syncQueuedAllTables = false;
      syncQueuedTables.clear();
      void triggerAutoSync(nextReason, nextTables);
    }
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

export function startLiveStockSync(storeId: string): () => void {
  stopLiveStockSync();
  if (!isSupabaseConfigured() || !storeId) return () => undefined;

  const queueLiveSync = (table: string) => {
    liveTables.add(table);
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(() => {
      liveDebounce = null;
      const changedTables = [...liveTables];
      liveTables.clear();
      void triggerAutoSync('live', changedTables);
    }, LIVE_DEBOUNCE_MS);
  };
  const tables = [...new Set([
    ...FAST_SYNC_TABLES,
    'stock_batches',
  ])];
  let channel = supabase.channel(`adimat-sync-${storeId}`);
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `store_id=eq.${storeId}` },
      () => queueLiveSync(table)
    );
  }
  liveChannel = channel.subscribe();

  return stopLiveStockSync;
}

export function stopLiveStockSync(): void {
  if (liveDebounce) {
    clearTimeout(liveDebounce);
    liveDebounce = null;
  }
  liveTables.clear();
  if (liveChannel) {
    void supabase.removeChannel(liveChannel);
    liveChannel = null;
  }
}

export function startAutoSync(): void {
  stopAutoSync();
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;

  syncTimer = setInterval(() => {
    void triggerAutoSync('interval');
  }, AUTO_SYNC_INTERVAL_MS);

  window.addEventListener('online', handleOnline);
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', handleVisible);
}

export function stopAutoSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('focus', handleFocus);
  document.removeEventListener('visibilitychange', handleVisible);
  if (liveCooldownTimer) {
    clearTimeout(liveCooldownTimer);
    liveCooldownTimer = null;
  }
  syncQueued = false;
  syncQueuedAllTables = false;
  syncQueuedTables.clear();
  stopLiveStockSync();
}

function handleOnline(): void {
  void triggerAutoSync('online');
}

function handleFocus(): void {
  void triggerAutoSync('focus');
}

function handleVisible(): void {
  if (document.visibilityState === 'visible') {
    void triggerAutoSync('visible');
  }
}

export function initAutoSync(): void {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  startAutoSync();
  void triggerAutoSync('startup');
}

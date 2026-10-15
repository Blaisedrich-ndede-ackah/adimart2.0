import { isSupabaseConfigured, supabase } from './supabase';
import { syncStockFast, syncToSupabase } from './dexie';

const AUTO_SYNC_KEY = 'adimat_auto_sync';
const LAST_SYNC_ERROR_KEY = 'adimat_last_sync_error';
const AUTO_SYNC_INTERVAL_MS = 45 * 1000;
const LIVE_DEBOUNCE_MS = 1500;

let syncInProgress = false;
let syncQueued = false;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastAutoSyncAt = 0;
let liveChannel: ReturnType<typeof supabase.channel> | null = null;

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

export async function triggerAutoSync(reason = 'auto'): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  const now = Date.now();
  if ((reason === 'auto' || reason === 'interval' || reason === 'live') && now - lastAutoSyncAt < 8_000) {
    return;
  }

  syncInProgress = true;
  try {
    const result = await syncStockFast();
    recordSyncOutcome(result);
    lastAutoSyncAt = Date.now();
  } catch (error) {
    recordSyncOutcome({ success: false, message: error instanceof Error ? error.message : String(error) });
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      void triggerAutoSync('queued');
    }
  }
}

/** Push local changes only — much faster after checkout / order fulfill. */
export async function triggerPushSync(reason = 'push'): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  syncInProgress = true;
  try {
    const result = await syncToSupabase();
    recordSyncOutcome(result);
    lastAutoSyncAt = Date.now();
  } catch (error) {
    recordSyncOutcome({ success: false, message: error instanceof Error ? error.message : String(error) });
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      void triggerAutoSync('queued');
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

  liveChannel = supabase
    .channel(`adimat-stock-${storeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stock_batches', filter: `store_id=eq.${storeId}` },
      () => {
        if (liveDebounce) clearTimeout(liveDebounce);
        liveDebounce = setTimeout(() => {
          liveDebounce = null;
          void triggerAutoSync('live');
        }, LIVE_DEBOUNCE_MS);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products', filter: `store_id=eq.${storeId}` },
      () => {
        if (liveDebounce) clearTimeout(liveDebounce);
        liveDebounce = setTimeout(() => {
          liveDebounce = null;
          void triggerAutoSync('live');
        }, LIVE_DEBOUNCE_MS);
      }
    )
    .subscribe();

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

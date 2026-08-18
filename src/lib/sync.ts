import { isSupabaseConfigured, supabase } from './supabase';
import { syncBidirectional, syncToSupabase } from './dexie';

const AUTO_SYNC_KEY = 'adimat_auto_sync';
const AUTO_SYNC_INTERVAL_MS = 20 * 1000;

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

export async function triggerAutoSync(reason = 'auto'): Promise<void> {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured() || !navigator.onLine) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  const now = Date.now();
  if (reason === 'auto' && now - lastAutoSyncAt < 8_000) return;

  syncInProgress = true;
  try {
    await syncBidirectional();
    lastAutoSyncAt = Date.now();
  } catch {
    // Silent fail for background sync
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
  if (!isAutoSyncEnabled() || !isSupabaseConfigured() || !navigator.onLine) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  syncInProgress = true;
  try {
    await syncToSupabase();
    lastAutoSyncAt = Date.now();
  } catch {
    // Silent fail for background sync
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      void triggerAutoSync('queued');
    }
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
        void triggerAutoSync('live');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products', filter: `store_id=eq.${storeId}` },
      () => {
        void triggerAutoSync('live');
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

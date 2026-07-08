import { isSupabaseConfigured } from './supabase';
import { syncBidirectional } from './dexie';

const AUTO_SYNC_KEY = 'adimat_auto_sync';
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000;

let syncInProgress = false;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastAutoSyncAt = 0;

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
  if (syncInProgress) return;

  const now = Date.now();
  if (reason === 'auto' && now - lastAutoSyncAt < 30_000) return;

  syncInProgress = true;
  try {
    await syncBidirectional();
    lastAutoSyncAt = Date.now();
  } catch {
    // Silent fail for background sync
  } finally {
    syncInProgress = false;
  }
}

export function startAutoSync(): void {
  stopAutoSync();
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;

  syncTimer = setInterval(() => {
    void triggerAutoSync('interval');
  }, AUTO_SYNC_INTERVAL_MS);

  window.addEventListener('online', handleOnline);
}

export function stopAutoSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  window.removeEventListener('online', handleOnline);
}

function handleOnline(): void {
  void triggerAutoSync('online');
}

export function initAutoSync(): void {
  if (!isAutoSyncEnabled() || !isSupabaseConfigured()) return;
  startAutoSync();
  void triggerAutoSync('startup');
}

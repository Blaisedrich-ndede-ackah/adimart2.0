/** Owner-configurable idle lock for store staff (PIN screen). */

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 5;
export const SESSION_TIMEOUT_OPTIONS = [0, 1, 2, 5, 10, 15, 30] as const;
export type SessionTimeoutMinutes = (typeof SESSION_TIMEOUT_OPTIONS)[number];

/** Show a warning this many ms before the till locks. */
export const SESSION_TIMEOUT_WARNING_MS = 30_000;

const LAST_ACTIVITY_PREFIX = 'adimat_last_activity_';
const IDLE_LOCK_KEY = 'adimat_idle_lock';
const TOUCH_THROTTLE_MS = 1000;

const lastTouchWrite = new Map<string, number>();

function allowedSet(): Set<number> {
  return new Set(SESSION_TIMEOUT_OPTIONS);
}

/** 0 = never lock. Missing/invalid values default to 5 minutes. */
export function normalizeSessionTimeoutMinutes(value: unknown): SessionTimeoutMinutes {
  const n = typeof value === 'number' ? value : Number(value);
  if (n === 0) return 0;
  if (allowedSet().has(n)) return n as SessionTimeoutMinutes;
  return DEFAULT_SESSION_TIMEOUT_MINUTES;
}

export function lastActivityStorageKey(storeId: string): string {
  return `${LAST_ACTIVITY_PREFIX}${storeId}`;
}

export function getLastActivityAt(storeId: string): number | null {
  if (typeof window === 'undefined' || !storeId) return null;
  try {
    const raw = window.localStorage.getItem(lastActivityStorageKey(storeId));
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

export function touchLastActivity(storeId: string, now = Date.now()): void {
  if (typeof window === 'undefined' || !storeId) return;
  const prev = lastTouchWrite.get(storeId) ?? 0;
  if (now - prev < TOUCH_THROTTLE_MS) return;
  lastTouchWrite.set(storeId, now);
  try {
    window.localStorage.setItem(lastActivityStorageKey(storeId), String(now));
  } catch {
    // Ignore quota / private mode
  }
}

export function clearLastActivity(storeId: string): void {
  if (typeof window === 'undefined' || !storeId) return;
  lastTouchWrite.delete(storeId);
  try {
    window.localStorage.removeItem(lastActivityStorageKey(storeId));
  } catch {
    // Ignore
  }
}

/** Milliseconds until lock, or null when timeout is off. */
export function getRemainingMs(
  storeId: string,
  timeoutMinutes: number,
  now = Date.now()
): number | null {
  if (timeoutMinutes <= 0) return null;
  const last = getLastActivityAt(storeId);
  const started = last ?? now;
  return started + timeoutMinutes * 60_000 - now;
}

export function isSessionIdle(
  storeId: string,
  timeoutMinutes: number,
  now = Date.now()
): boolean {
  if (timeoutMinutes <= 0 || !storeId) return false;
  const last = getLastActivityAt(storeId);
  if (last == null) return false;
  return now - last >= timeoutMinutes * 60_000;
}

export function markIdleLock(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(IDLE_LOCK_KEY, '1');
  } catch {
    // Ignore
  }
}

/** True once per idle lock; used so a refresh of the PIN screen still explains why. */
export function consumeIdleLock(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const flagged = window.sessionStorage.getItem(IDLE_LOCK_KEY) === '1';
    if (flagged) window.sessionStorage.removeItem(IDLE_LOCK_KEY);
    return flagged;
  } catch {
    return false;
  }
}

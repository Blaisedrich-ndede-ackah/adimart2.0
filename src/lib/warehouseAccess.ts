/**
 * Warehouse switch session — mirrors store switch:
 * pending login after sign-out, then unlocked workspace after PIN.
 */

const UNLOCK_KEY = 'adimat_warehouse_unlock_v1';
const PENDING_KEY = 'adimat_warehouse_pending_v1';

export interface WarehouseUnlockSession {
  storeId: string;
  locationId: string;
  unlockedAt: number;
}

export interface PendingWarehouseLogin {
  storeId: string;
  locationId: string;
  name: string;
}

function readJson<T>(key: string): T | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setPendingWarehouseLogin(pending: PendingWarehouseLogin): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function getPendingWarehouseLogin(): PendingWarehouseLogin | null {
  const pending = readJson<PendingWarehouseLogin>(PENDING_KEY);
  if (!pending?.storeId || !pending?.locationId) return null;
  return pending;
}

export function clearPendingWarehouseLogin(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(PENDING_KEY);
}

export function unlockWarehouseLocation(storeId: string, locationId: string): void {
  const session: WarehouseUnlockSession = {
    storeId,
    locationId,
    unlockedAt: Date.now(),
  };
  sessionStorage.setItem(UNLOCK_KEY, JSON.stringify(session));
  clearPendingWarehouseLogin();
}

export function getUnlockedWarehouseLocationId(storeId: string): string | null {
  const session = readJson<WarehouseUnlockSession>(UNLOCK_KEY);
  if (!session || session.storeId !== storeId) return null;
  return session.locationId;
}

export function clearWarehouseUnlock(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(UNLOCK_KEY);
}

/** Clear pending + unlock (logout / store switch). */
export function clearAllWarehouseSessions(): void {
  clearPendingWarehouseLogin();
  clearWarehouseUnlock();
}

/**
 * Session unlock for warehouse locations opened from Settings with a PIN.
 */

const STORAGE_KEY = 'adimat_warehouse_unlock_v1';

export interface WarehouseUnlockSession {
  storeId: string;
  locationId: string;
  unlockedAt: number;
}

function readSession(): WarehouseUnlockSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WarehouseUnlockSession;
    if (!parsed?.storeId || !parsed?.locationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function unlockWarehouseLocation(storeId: string, locationId: string): void {
  const session: WarehouseUnlockSession = {
    storeId,
    locationId,
    unlockedAt: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getUnlockedWarehouseLocationId(storeId: string): string | null {
  const session = readSession();
  if (!session || session.storeId !== storeId) return null;
  return session.locationId;
}

export function clearWarehouseUnlock(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

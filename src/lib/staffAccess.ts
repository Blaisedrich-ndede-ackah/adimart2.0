/**
 * Staff permission helpers (owner vs cashier).
 */

export function canAccessCashbook(user?: {
  role?: string | null;
  can_access_cashbook?: number | null;
} | null): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  // Legacy cashiers with no flag keep Cash Book until the owner turns it off.
  return (user.can_access_cashbook ?? 1) === 1;
}

/** 0 or 1 when the cloud sent a real boolean. Missing column stays unset. */
export function optionalStaffFlag(value: unknown): number | undefined {
  if (value === true || value === 1 || value === 'true' || value === '1') return 1;
  if (value === false || value === 0 || value === 'false' || value === '0') return 0;
  return undefined;
}

export function canApplyDiscount(
  user?: { role?: string | null; can_discount?: number | null } | null,
  store?: { cashier_can_discount?: number | null } | null
): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.can_discount === 0 || user.can_discount === 1) return user.can_discount === 1;
  return (store?.cashier_can_discount ?? 1) === 1;
}

type StockStore = {
  cashier_can_see_stock?: number | null;
  cashiers_can_view_stock?: number | null;
} | null;

/**
 * Store-wide switch. An explicit cashier_can_see_stock wins. Otherwise the
 * older cashiers_can_view_stock flag is used. When neither is set, cashiers
 * do not see quantities until the owner allows it.
 */
export function storeAllowsCashierStock(store?: StockStore): boolean {
  if (store?.cashier_can_see_stock === 0 || store?.cashier_can_see_stock === 1) {
    return store.cashier_can_see_stock === 1;
  }
  return (store?.cashiers_can_view_stock ?? 0) === 1;
}

/**
 * Owners always see on-hand quantities. Cashiers see them only when the
 * store switch is on, and a per-cashier "off" still hides them.
 */
export function canSeeStockQuantities(
  user?: { role?: string | null; can_view_stock?: number | null } | null,
  store?: StockStore
): boolean {
  if (user?.role === 'owner') return true;
  if (user?.role !== 'cashier') return false;
  if (!storeAllowsCashierStock(store)) return false;
  if (user.can_view_stock === 0) return false;
  return true;
}

export function cashierCanSeeStockQuantity(
  user?: { role?: string | null; can_view_stock?: number | null } | null,
  store?: StockStore
): boolean {
  return canSeeStockQuantities(user, store);
}

/** Map a cloud boolean onto local 0/1. Missing column = allowed (legacy). */
export function cashbookAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === false || value === 0 || value === 'false') return 0;
  return 1;
}

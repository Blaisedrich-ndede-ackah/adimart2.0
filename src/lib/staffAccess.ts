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

/**
 * Owners always see on-hand quantities. Cashiers see them only after the
 * owner turns the setting on. Missing flag stays hidden.
 */
export function cashierCanSeeStockQuantity(
  user?: { role?: string | null } | null,
  store?: { cashier_can_see_stock?: number | null } | null
): boolean {
  if (user?.role === 'owner') return true;
  if (user?.role !== 'cashier') return false;
  return (store?.cashier_can_see_stock ?? 0) === 1;
}

/** Map a cloud boolean onto local 0/1. Missing column = allowed (legacy). */
export function cashbookAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === false || value === 0 || value === 'false') return 0;
  return 1;
}

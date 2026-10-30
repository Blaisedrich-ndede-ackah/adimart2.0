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

export function canSeeStockQuantities(
  user?: { role?: string | null; can_view_stock?: number | null } | null,
  store?: { cashiers_can_view_stock?: number | null } | null
): boolean {
  if (user?.role === 'owner') return true;
  if (user?.can_view_stock === 0 || user?.can_view_stock === 1) return user.can_view_stock === 1;
  return (store?.cashiers_can_view_stock ?? 1) === 1;
}

/** Map a cloud boolean onto local 0/1. Missing column = allowed (legacy). */
export function cashbookAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === false || value === 0 || value === 'false') return 0;
  return 1;
}

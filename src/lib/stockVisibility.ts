import { canSeeStockQuantities } from '@/lib/staffAccess';

/** Owners always see quantities. Each cashier follows their Perms setting. */
export function canViewStockQuantities(
  user: { role?: string | null; can_view_stock?: number | null } | null | undefined,
  store: { cashiers_can_view_stock?: number | null } | null | undefined
): boolean {
  return canSeeStockQuantities(user, store);
}

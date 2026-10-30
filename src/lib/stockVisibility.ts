import { canSeeStockQuantities } from '@/lib/staffAccess';

/** Owners always see quantities. Cashiers follow the store switch and their own Perms flag. */
export function canViewStockQuantities(
  user: { role?: string | null; can_view_stock?: number | null } | null | undefined,
  store: { cashier_can_see_stock?: number | null; cashiers_can_view_stock?: number | null } | null | undefined
): boolean {
  return canSeeStockQuantities(user, store);
}

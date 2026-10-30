/** Owners always see quantities. Cashiers follow the store setting (default on). */
export function canViewStockQuantities(
  user: { role?: string | null } | null | undefined,
  store: { cashiers_can_view_stock?: number | null } | null | undefined
): boolean {
  if (user?.role === 'owner') return true;
  return (store?.cashiers_can_view_stock ?? 1) === 1;
}

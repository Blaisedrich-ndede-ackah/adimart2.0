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

/** Map a cloud boolean onto local 0/1. Missing column = allowed (legacy). */
export function cashbookAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === false || value === 0 || value === 'false') return 0;
  return 1;
}

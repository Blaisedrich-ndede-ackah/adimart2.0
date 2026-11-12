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

/** Cashiers record a customer account payment and print its receipt only when the owner turns this on. */
export function canRecordCustomerPayments(user?: {
  role?: string | null;
  can_record_customer_payments?: number | null;
} | null): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return (user.can_record_customer_payments ?? 0) === 1;
}

export function customerPaymentsAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === true || value === 1 || value === 'true') return 1;
  return 0;
}

/** Map a cloud boolean onto local 0/1. Missing column = allowed (legacy). */
export function cashbookAccessFromCloud(role: unknown, value: unknown): number {
  if (role === 'owner') return 1;
  if (value === false || value === 0 || value === 'false') return 0;
  return 1;
}

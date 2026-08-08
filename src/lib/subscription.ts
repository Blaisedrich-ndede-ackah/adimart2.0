/** Monthly store subscription helpers (admin-granted). */

export type SubscriptionStatus = 'none' | 'active' | 'expired';

export const SUBSCRIPTION_WARNING_DAYS = 7;

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  expiresAt: string | null;
  startedAt: string | null;
  daysLeft: number | null;
  /** True when active but within warning window */
  isExpiringSoon: boolean;
  /** True when expired (or past due) */
  isExpired: boolean;
  /** True when store should see a banner */
  shouldWarn: boolean;
}

export function addMonthsIso(fromIso: string, months: number): string {
  const d = new Date(fromIso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Handle month-end overflow (e.g. Jan 31 + 1 month)
  if (d.getUTCDate() < day) {
    d.setUTCDate(0);
  }
  return d.toISOString();
}

export function getSubscriptionInfo(
  expiresAt: string | null | undefined,
  startedAt?: string | null | undefined
): SubscriptionInfo {
  if (!expiresAt) {
    return {
      status: 'none',
      expiresAt: null,
      startedAt: startedAt || null,
      daysLeft: null,
      isExpiringSoon: false,
      isExpired: false,
      shouldWarn: false,
    };
  }

  const now = Date.now();
  const expMs = new Date(expiresAt).getTime();
  const daysLeft = Math.ceil((expMs - now) / (1000 * 60 * 60 * 24));
  const isExpired = daysLeft <= 0;
  const isExpiringSoon = !isExpired && daysLeft <= SUBSCRIPTION_WARNING_DAYS;

  return {
    status: isExpired ? 'expired' : 'active',
    expiresAt,
    startedAt: startedAt || null,
    daysLeft,
    isExpiringSoon,
    isExpired,
    shouldWarn: isExpired || isExpiringSoon,
  };
}

export function formatSubscriptionDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'expired':
      return 'Expired';
    default:
      return 'None';
  }
}

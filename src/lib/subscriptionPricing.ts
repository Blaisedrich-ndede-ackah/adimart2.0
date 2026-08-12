/**
 * Adimat POS self-serve subscription packages (base price = 1 shop).
 * Annual packages already include 2 months free per year in the listed price.
 * Final charge = baseGhs × billableUnits, where units = max(1, max_shops + max_warehouses).
 */

export interface SubscriptionPackage {
  id: string;
  label: string;
  months: number;
  /** Base price in GHS for a single shop */
  baseGhs: number;
  /** Shown under annual options */
  saveNote?: string;
}

export const SUBSCRIPTION_PACKAGES: SubscriptionPackage[] = [
  { id: '1m', label: '1 Month', months: 1, baseGhs: 70 },
  { id: '3m', label: '3 Months', months: 3, baseGhs: 210 },
  { id: '6m', label: '6 Months', months: 6, baseGhs: 420 },
  {
    id: '1y',
    label: '1 Year',
    months: 12,
    baseGhs: 700,
    saveNote: 'Save 140 GHS (2 months free)',
  },
  {
    id: '2y',
    label: '2 Years',
    months: 24,
    baseGhs: 1400,
    saveNote: 'Save 280 GHS (4 months free)',
  },
  {
    id: '3y',
    label: '3 Years',
    months: 36,
    baseGhs: 2100,
    saveNote: 'Save 420 GHS (6 months free)',
  },
  {
    id: '4y',
    label: '4 Years',
    months: 48,
    baseGhs: 2800,
    saveNote: 'Save 560 GHS (8 months free)',
  },
];

export function getSubscriptionPackage(id: string): SubscriptionPackage | undefined {
  return SUBSCRIPTION_PACKAGES.find((p) => p.id === id);
}

/** Bill for entitled shop + warehouse capacity (admin quotas). */
export function getBillableUnits(store: {
  max_shops?: number | null;
  max_warehouses?: number | null;
}): { shops: number; warehouses: number; units: number } {
  const shops = Math.max(1, Math.floor(Number(store.max_shops) || 1));
  const warehouses = Math.max(0, Math.floor(Number(store.max_warehouses) || 0));
  return {
    shops,
    warehouses,
    units: Math.max(1, shops + warehouses),
  };
}

export function priceForPackage(
  pkg: SubscriptionPackage,
  units: number
): { ghs: number; pesewas: number; units: number } {
  const u = Math.max(1, Math.floor(units) || 1);
  const ghs = pkg.baseGhs * u;
  return { ghs, pesewas: Math.round(ghs * 100), units: u };
}

export function formatGhsAmount(ghs: number): string {
  return `GH₵${ghs.toLocaleString(undefined, {
    minimumFractionDigits: ghs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

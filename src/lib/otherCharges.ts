import { roundMoney, toMoneyAmount } from './money';

export const OTHER_CHARGE_CATEGORIES = [
  { id: 'delivery', label: 'Delivery Charge' },
  { id: 'packing', label: 'Packing Charge' },
  { id: 'service', label: 'Service Charge/Fee' },
  { id: 'other', label: 'Other Charge' },
] as const;

export type OtherChargeCategoryId = (typeof OTHER_CHARGE_CATEGORIES)[number]['id'];

export interface OtherCharge {
  id: OtherChargeCategoryId;
  label: string;
  amount: number;
}

export function getOtherChargeCategory(
  id: string
): (typeof OTHER_CHARGE_CATEGORIES)[number] | undefined {
  return OTHER_CHARGE_CATEGORIES.find((c) => c.id === id);
}

export function otherChargesTotal(charges: OtherCharge[] | null | undefined): number {
  if (!charges?.length) return 0;
  return roundMoney(charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0));
}

export function serializeOtherCharges(charges: OtherCharge[] | null | undefined): string {
  return JSON.stringify(
    (charges || [])
      .filter((c) => c && toMoneyAmount(c.amount) > 0)
      .map((c) => ({
        id: c.id,
        label: (c.label || getOtherChargeCategory(c.id)?.label || 'Other Charge').trim(),
        amount: roundMoney(toMoneyAmount(c.amount)),
      }))
  );
}

export function parseOtherCharges(raw: unknown): OtherCharge[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[]') return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const charges: OtherCharge[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const idRaw = String(rec.id || '');
    const category = getOtherChargeCategory(idRaw) || OTHER_CHARGE_CATEGORIES[3];
    if (seen.has(category.id)) continue;
    const amount = roundMoney(toMoneyAmount(rec.amount));
    if (amount <= 0) continue;
    const label =
      String(rec.label || '').trim() || category.label;
    seen.add(category.id);
    charges.push({ id: category.id, label, amount });
  }
  return charges;
}

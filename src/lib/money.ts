/** Production money helpers — always round to whole pesewas (2 dp). */

export function roundMoney(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Non-negative money amount rounded to 2 dp. */
export function toMoneyAmount(value: unknown): number {
  return Math.max(0, roundMoney(value));
}

/**
 * Fold VAT into a price and round to the nearest pesewa.
 * The result is the selling price. Receipts charge this amount and do not print a VAT line.
 */
export function vatInclusivePrice(amount: unknown, ratePercent: unknown): number {
  const base = toMoneyAmount(amount);
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return base;
  return toMoneyAmount(base * (1 + rate / 100));
}

/** Integer base units for stock (never fractional shelf units). */
export function lineBaseQty(item: { quantity: number; base_quantity?: number | null }): number {
  const base = Number(item.base_quantity);
  if (Number.isFinite(base) && base > 0) return Math.floor(base);
  const qty = Number(item.quantity);
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
}

export function moneyEquals(a: number, b: number, epsilon = 0.009): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= epsilon;
}

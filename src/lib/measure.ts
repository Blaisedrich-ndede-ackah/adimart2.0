/** Quantity helpers for whole items and goods sold by weight or measure. */

export const MEASURE_UNITS = [
  'pcs',
  'kg',
  'g',
  'litre',
  'ml',
  'yard',
  'metre',
  'olonka',
  'bag',
  'crate',
] as const;

export type MeasureUnit = (typeof MEASURE_UNITS)[number];

const MAX_QTY = 50_000_000;

export function productAllowsDecimal(product: { allow_decimal?: number | null } | null | undefined): boolean {
  return product?.allow_decimal === 1;
}

/** Up to 3 decimal places. Whole numbers stay whole numbers (5 stays 5). */
export function roundStockQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rounded = Math.round(n * 1000) / 1000;
  return rounded > MAX_QTY ? 0 : rounded;
}

/** Same rounding, but zero is a valid on-hand quantity. */
export function roundStockQtyAllowZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  const rounded = Math.round(n * 1000) / 1000;
  return rounded > MAX_QTY ? 0 : rounded;
}

/**
 * Piece products keep the existing whole-number rule (2.9 becomes 2).
 * Measured products keep decimals such as 2.5 kg.
 */
export function quantityForProduct(value: unknown, allowDecimal: boolean): number {
  if (allowDecimal) return roundStockQty(value);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const floored = Math.floor(n);
  return floored > MAX_QTY ? 0 : floored;
}

export function formatQty(value: unknown, unit?: string | null): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const cleanUnit = (unit || '').trim();
  if (!cleanUnit || cleanUnit === 'pcs') return text;
  return `${text} ${cleanUnit}`;
}

export function isPositiveQty(value: unknown, allowDecimal: boolean): boolean {
  return quantityForProduct(value, allowDecimal) > 0;
}

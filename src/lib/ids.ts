import { v5 as uuidv5, validate as uuidValidate } from 'uuid';

/** Namespace so every device derives the same shop / opening-batch UUIDs. */
const ADIMAT_NS = 'a1d1a700-0ad1-41a7-9e50-5c0ffee00001';

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && uuidValidate(value);
}

export function uuidOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return uuidValidate(trimmed) ? trimmed : null;
}

export function stableUuid(name: string): string {
  return uuidv5(name, ADIMAT_NS);
}

/** One shop row per store — valid UUID so Postgres upserts succeed. */
export function canonicalShopId(storeId: string): string {
  return stableUuid(`shop:${storeId}`);
}

/** One OPENING batch per product — valid UUID so devices do not mint duplicates. */
export function openingBatchId(storeId: string, productId: string): string {
  return stableUuid(`opening:${storeId}:${productId}`);
}

export function legacyShopId(storeId: string): string {
  return `shop_${storeId}`;
}

export function formatUnknownError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error);
}

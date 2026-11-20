/**
 * Lightweight offline product search.
 * Unit tokens such as "400g" must match exactly. Other tokens allow a
 * short typo (edit distance 1, or 2 once the token is 6+ characters).
 */

const UNIT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kg|g|mg|ml|l|cl|oz|lb|pcs|pc|pack)\b/gi;

export interface SearchableProduct {
  name: string;
  barcode?: string;
  category?: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(UNIT_PATTERN, (_match, amount: string, unit: string) => `${amount.replace(',', '.')}${unit.toLowerCase()}`)
    .replace(/[^a-z0-9.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ') : [];
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;
  const previous = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j++) previous[j] = j;
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = above;
    }
    if (previous[right.length] > 2 && i > 2) {
      // Still finish; the cap is applied by the caller.
    }
  }
  return previous[right.length];
}

function isUnitToken(token: string): boolean {
  return /^\d+(?:\.\d+)?(?:kg|g|mg|ml|l|cl|oz|lb|pcs|pc|pack)$/.test(token);
}

function tokenScore(queryToken: string, productToken: string): number {
  if (queryToken === productToken) return 1;
  if (isUnitToken(queryToken) || isUnitToken(productToken)) return 0;
  if (queryToken.length >= 2 && productToken.startsWith(queryToken)) return 0.9;
  if (queryToken.length < 4 || queryToken[0] !== productToken[0]) return 0;
  const maxDistance = queryToken.length >= 6 ? 2 : 1;
  const distance = editDistance(queryToken, productToken);
  if (distance > maxDistance) return 0;
  return 0.8 - distance * 0.15;
}

/** Higher is a better match. Zero means the query does not match. */
export function scoreSmartSearch(product: SearchableProduct, query: string): number {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 1;
  const barcode = (product.barcode || '').trim().toLowerCase();
  if (barcode && barcode === trimmed) return 1000;
  if (barcode && (barcode.includes(trimmed) || (trimmed.length >= 3 && trimmed.includes(barcode) && barcode.length >= 3))) {
    return 900;
  }
  const queryTokens = searchTokens(trimmed);
  if (queryTokens.length === 0) return 0;
  const productTokens = searchTokens(`${product.name} ${product.category || ''}`);
  if (productTokens.length === 0) return 0;
  let score = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const productToken of productTokens) {
      best = Math.max(best, tokenScore(queryToken, productToken));
    }
    if (best === 0) return 0;
    score += best;
  }
  const name = normalizeSearchText(product.name);
  if (name.startsWith(normalizeSearchText(trimmed))) score += 0.5;
  return Math.round(score * 100);
}

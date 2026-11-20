import { completedSales, itemsBySale } from './snapshot';
import type { AiSnapshot, Pair } from './types';

export interface AlsoBuySuggestion {
  productId: string;
  name: string;
  count: number;
  whyKey: string;
  whyVars: Record<string, string | number>;
}

export function analyzePairs(snapshot: AiSnapshot): Pair[] {
  const sales = new Set(completedSales(snapshot, null).map((sale) => sale.id));
  const counts = new Map<string, number>();
  for (const [transactionId, items] of itemsBySale(snapshot)) {
    if (!sales.has(transactionId)) continue;
    const ids = [...new Set(items.map((item) => item.productId))].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const pairs: Pair[] = [];
  for (const [key, count] of counts) {
    const [a, b] = key.split('|');
    pairs.push({ a, b, count });
  }
  pairs.sort((left, right) => right.count - left.count);
  return pairs;
}

export function suggestBoughtTogether(
  pairs: Pair[],
  names: Record<string, string>,
  cartIds: string[],
  limit = 3
): AlsoBuySuggestion[] {
  const inCart = new Set(cartIds);
  if (inCart.size === 0) return [];
  const scores = new Map<string, number>();
  for (const pair of pairs) {
    const aIn = inCart.has(pair.a);
    const bIn = inCart.has(pair.b);
    if (aIn === bIn) continue;
    const other = aIn ? pair.b : pair.a;
    if (inCart.has(other)) continue;
    scores.set(other, (scores.get(other) || 0) + pair.count);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([productId, count]) => ({
      productId,
      name: names[productId] || productId,
      count,
      whyKey: 'ai.why.alsoBuy',
      whyVars: { name: names[productId] || productId, count },
    }));
}

import type { AiSale, AiSaleItem, AiSnapshot } from './types';
import { addDays, dayKey, parseDate, startOfLocalDay, toYmd } from './dates';

export function nowOf(snapshot: AiSnapshot): Date {
  return parseDate(snapshot.now);
}

export function completedSales(snapshot: AiSnapshot, locationId: string | null = snapshot.locationId): AiSale[] {
  return snapshot.sales.filter((sale) => {
    if (sale.status !== 'completed') return false;
    if (locationId && sale.locationId && sale.locationId !== locationId) return false;
    return true;
  });
}

export function itemsBySale(snapshot: AiSnapshot): Map<string, AiSaleItem[]> {
  const map = new Map<string, AiSaleItem[]>();
  for (const item of snapshot.items) {
    const list = map.get(item.transactionId);
    if (list) list.push(item);
    else map.set(item.transactionId, [item]);
  }
  return map;
}

export function productName(snapshot: AiSnapshot, productId: string): string {
  return snapshot.products.find((product) => product.id === productId)?.name || productId;
}

export function locationName(snapshot: AiSnapshot, locationId: string): string {
  return snapshot.locations.find((location) => location.id === locationId)?.name || locationId;
}

export function historySpanDays(snapshot: AiSnapshot): number {
  const sales = completedSales(snapshot, null);
  if (sales.length === 0) return 0;
  const now = startOfLocalDay(nowOf(snapshot));
  let oldest = now.getTime();
  for (const sale of sales) {
    const time = startOfLocalDay(parseDate(sale.createdAt)).getTime();
    if (time < oldest) oldest = time;
  }
  return Math.max(0, Math.round((now.getTime() - oldest) / 86_400_000));
}

export function qtyByProductDay(
  snapshot: AiSnapshot,
  locationId: string | null,
  since: Date
): Map<string, Map<string, number>> {
  const sales = new Map(completedSales(snapshot, locationId).map((sale) => [sale.id, sale]));
  const grouped = new Map<string, Map<string, number>>();
  const sinceTime = since.getTime();
  for (const item of snapshot.items) {
    const sale = sales.get(item.transactionId);
    if (!sale) continue;
    const when = parseDate(sale.createdAt);
    if (when.getTime() < sinceTime) continue;
    let days = grouped.get(item.productId);
    if (!days) {
      days = new Map();
      grouped.set(item.productId, days);
    }
    const key = dayKey(when);
    days.set(key, (days.get(key) || 0) + item.quantity);
  }
  return grouped;
}

export function cutoffYmd(snapshot: AiSnapshot, days: number): string {
  return toYmd(addDays(startOfLocalDay(nowOf(snapshot)), days));
}

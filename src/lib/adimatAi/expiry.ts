import { addDays, daysBetween, roundTo, startOfLocalDay, toYmd } from './dates';
import { markdownPercent } from './pricing';
import {
  completedSales,
  historySpanDays,
  locationName,
  nowOf,
  productName,
  qtyByProductDay,
} from './snapshot';
import type { AiSnapshot, ExpiryAlert, TransferSuggestion } from './types';

function weeklySales(snapshot: AiSnapshot, productId: string, locationId: string | null, weeks: number): number {
  const since = addDays(startOfLocalDay(nowOf(snapshot)), -weeks * 7);
  const days = qtyByProductDay(snapshot, locationId, since).get(productId);
  if (!days) return 0;
  let qty = 0;
  for (const value of days.values()) qty += value;
  return qty / weeks;
}

function transferFor(
  snapshot: AiSnapshot,
  productId: string,
  onHand: number,
  reorderLevel: number
): TransferSuggestion | undefined {
  if (!snapshot.locationId || snapshot.locations.length < 2 || onHand < 2) return undefined;
  const weeks = Math.max(4, Math.min(8, snapshot.settings.restockWeeks));
  const here = weeklySales(snapshot, productId, snapshot.locationId, weeks);
  let best: { id: string; weekly: number } | null = null;
  for (const location of snapshot.locations) {
    if (location.id === snapshot.locationId) continue;
    const weekly = weeklySales(snapshot, productId, location.id, weeks);
    if (!best || weekly > best.weekly) best = { id: location.id, weekly };
  }
  if (!best || best.weekly < 1 || best.weekly < here * 1.5) return undefined;
  const keep = Math.max(reorderLevel, Math.ceil(here));
  const quantity = Math.min(onHand, Math.max(1, Math.round(best.weekly * 2)));
  const movable = onHand - keep;
  if (movable < 1) return undefined;
  const move = Math.min(quantity, movable);
  return {
    toLocationId: best.id,
    toLocationName: locationName(snapshot, best.id),
    quantity: move,
    whyKey: 'ai.why.transfer',
    whyVars: {
      location: locationName(snapshot, best.id),
      there: roundTo(best.weekly, 1),
      here: roundTo(here, 1),
      qty: move,
    },
  };
}

export function analyzeExpiry(snapshot: AiSnapshot): { expiry: ExpiryAlert[]; deadStock: ExpiryAlert[] } {
  const now = nowOf(snapshot);
  const cutoff = toYmd(addDays(startOfLocalDay(now), snapshot.settings.expiryDays));
  const idSet = snapshot.expiringBatchIds ? new Set(snapshot.expiringBatchIds) : null;
  const weeks = Math.max(4, snapshot.settings.deadStockWeeks);
  const expiry: ExpiryAlert[] = [];
  const seenProduct = new Set<string>();

  for (const batch of snapshot.batches) {
    if (batch.quantity <= 0 || !batch.expiryDate) continue;
    if (snapshot.locationId && batch.locationId !== snapshot.locationId) continue;
    const listed = idSet ? idSet.has(batch.id) : batch.expiryDate <= cutoff && batch.expiryDate >= '0000-01-01';
    if (!listed || batch.expiryDate > cutoff) continue;
    const product = snapshot.products.find((item) => item.id === batch.productId);
    const name = product?.name || productName(snapshot, batch.productId);
    const days = daysBetween(new Date(batch.expiryDate + 'T00:00:00'), now);
    const weekly = weeklySales(snapshot, batch.productId, snapshot.locationId, 4);
    const percent = markdownPercent({
      daysToExpiry: days,
      windowDays: snapshot.settings.expiryDays,
      stock: batch.quantity,
      weeklySales: weekly,
    });
    const confidence = completedSales(snapshot).length < 8 ? 'low' : weekly > 0 ? 'high' : 'medium';
    expiry.push({
      id: `exp-${batch.id}`,
      kind: 'expiring',
      productId: batch.productId,
      productName: name,
      quantity: batch.quantity,
      markdownPercent: percent,
      daysToExpiry: days,
      confidence,
      transfer: transferFor(snapshot, batch.productId, batch.quantity, product?.reorderLevel || 0),
      whyKey: 'ai.why.expiring',
      whyVars: {
        name,
        qty: batch.quantity,
        location: locationName(snapshot, batch.locationId),
        days,
        weekly: roundTo(weekly, 1),
        percent,
      },
    });
    seenProduct.add(batch.productId);
  }

  const deadStock: ExpiryAlert[] = [];
  const span = historySpanDays(snapshot);
  if (span >= snapshot.settings.deadStockWeeks * 7) {
    const since = addDays(startOfLocalDay(now), -snapshot.settings.deadStockWeeks * 7);
    const sold = qtyByProductDay(snapshot, snapshot.locationId, since);
    for (const product of snapshot.products) {
      if (!product.active || product.stock <= 0 || seenProduct.has(product.id)) continue;
      const onHand = onHandAtLocation(snapshot, product.id, product.stock);
      if (onHand <= 0) continue;
      const recent = sold.get(product.id);
      if (recent && [...recent.values()].some((qty) => qty > 0)) continue;
      const percent = markdownPercent({
        daysToExpiry: null,
        windowDays: snapshot.settings.expiryDays,
        stock: onHand,
        weeklySales: 0,
      });
      deadStock.push({
        id: `dead-${product.id}`,
        kind: 'dead',
        productId: product.id,
        productName: product.name,
        quantity: onHand,
        markdownPercent: percent,
        daysToExpiry: null,
        confidence: span >= snapshot.settings.deadStockWeeks * 10 ? 'high' : 'medium',
        transfer: transferFor(snapshot, product.id, onHand, product.reorderLevel),
        whyKey: 'ai.why.dead',
        whyVars: {
          name: product.name,
          qty: onHand,
          weeks: snapshot.settings.deadStockWeeks,
          percent,
        },
      });
    }
  }

  expiry.sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));
  return { expiry: expiry.slice(0, 40), deadStock: deadStock.slice(0, 40) };
}

function onHandAtLocation(snapshot: AiSnapshot, productId: string, fallback: number): number {
  const batches = snapshot.batches.filter(
    (batch) => batch.productId === productId && (!snapshot.locationId || batch.locationId === snapshot.locationId)
  );
  if (batches.length === 0) return fallback;
  return batches.reduce((sum, batch) => sum + batch.quantity, 0);
}

export function onHandQuantity(snapshot: AiSnapshot, productId: string, fallback: number): number {
  return onHandAtLocation(snapshot, productId, fallback);
}

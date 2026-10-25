import { roundTo } from './dates';
import { daysOfCover, weightedDailyDemand } from './demand';
import { onHandQuantity } from './expiry';
import { addDays, startOfLocalDay } from './dates';
import { nowOf, qtyByProductDay } from './snapshot';
import type { AiSnapshot, RestockGroup, RestockLine } from './types';

function openPoQty(snapshot: AiSnapshot, productId: string): number {
  let qty = 0;
  for (const order of snapshot.orders) {
    if (order.status !== 'ordered' && order.status !== 'partially_received') continue;
    for (const line of order.lines) {
      if (line.productId !== productId) continue;
      qty += Math.max(0, line.quantity - line.received);
    }
  }
  return qty;
}

function supplierFor(snapshot: AiSnapshot, productId: string): { id: string; name: string } {
  const matches = snapshot.orders
    .filter((order) => order.lines.some((line) => line.productId === productId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const supplierId = matches[0]?.supplierId || '';
  const name = snapshot.suppliers.find((supplier) => supplier.id === supplierId)?.name || '';
  return { id: supplierId, name: name || 'Unassigned' };
}

function unitCost(snapshot: AiSnapshot, productId: string, fallback: number): number {
  const batches = snapshot.batches
    .filter((batch) => batch.productId === productId && batch.costPrice > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (batches[0]) return batches[0].costPrice;
  return fallback;
}

export function analyzeRestock(snapshot: AiSnapshot): RestockGroup[] {
  const now = nowOf(snapshot);
  const since = addDays(startOfLocalDay(now), -snapshot.settings.restockWeeks * 7);
  const byProduct = qtyByProductDay(snapshot, snapshot.locationId, since);
  const horizon = snapshot.settings.leadTimeDays + snapshot.settings.coverDays;
  const groups = new Map<string, RestockGroup>();

  for (const product of snapshot.products) {
    if (!product.active) continue;
    const onHand = onHandQuantity(snapshot, product.id, product.stock);
    const open = openPoQty(snapshot, product.id);
    const estimate = weightedDailyDemand(byProduct.get(product.id) || new Map(), now, snapshot.settings.restockWeeks, horizon);
    const lowHistory = estimate.observedDays < 3;
    let suggested = 0;
    let whyKey = 'ai.why.restock';
    let confidence: RestockLine['confidence'] = estimate.observedDays >= 14 ? 'high' : 'medium';
    if (lowHistory) {
      suggested = Math.max(0, Math.ceil(product.reorderLevel - onHand - open));
      whyKey = 'ai.why.restockLow';
      confidence = 'low';
    } else {
      const target = Math.max(product.reorderLevel, estimate.demand);
      suggested = Math.max(0, Math.ceil(target - onHand - open));
      if (estimate.observedDays < 8) confidence = 'low';
    }
    if (suggested < 1) continue;
    const supplier = supplierFor(snapshot, product.id);
    const line: RestockLine = {
      productId: product.id,
      productName: product.name,
      onHand,
      reorderLevel: product.reorderLevel,
      openPoQty: open,
      weightedDaily: roundTo(estimate.daily, 2),
      daysOfStock: daysOfCover(onHand, estimate.daily),
      suggestedQty: suggested,
      unitCost: unitCost(snapshot, product.id, product.costPrice),
      confidence,
      whyKey,
      whyVars: {
        name: product.name,
        daily: roundTo(estimate.daily, 1),
        days: daysOfCover(onHand, estimate.daily) ?? '—',
        onHand,
        open,
        reorder: product.reorderLevel,
        qty: suggested,
        horizon,
        lead: snapshot.settings.leadTimeDays,
        cover: snapshot.settings.coverDays,
      },
    };
    const group = groups.get(supplier.id) || { supplierId: supplier.id, supplierName: supplier.name, lines: [] };
    group.lines.push(line);
    groups.set(supplier.id, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, lines: group.lines.sort((a, b) => b.suggestedQty - a.suggestedQty) }))
    .sort((a, b) => b.lines.length - a.lines.length);
}

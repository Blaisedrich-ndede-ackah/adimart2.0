import { roundTo } from './dates';
import { marginRatio, priceToRestoreMargin } from './pricing';
import type { AiSnapshot, MarginAlert } from './types';

interface CostPoint {
  at: string;
  cost: number;
}

export function analyzeMargins(snapshot: AiSnapshot): MarginAlert[] {
  const alerts: MarginAlert[] = [];
  for (const product of snapshot.products) {
    if (!product.active || product.sellingPrice <= 0) continue;
    const points: CostPoint[] = [];
    for (const batch of snapshot.batches) {
      if (batch.productId === product.id && batch.costPrice > 0) {
        if (snapshot.locationId && batch.locationId !== snapshot.locationId) continue;
        points.push({ at: batch.createdAt, cost: batch.costPrice });
      }
    }
    if (points.length < 2) {
      points.length = 0;
      for (const order of snapshot.orders) {
        for (const line of order.lines) {
          if (line.productId === product.id && line.unitCost > 0) {
            points.push({ at: order.createdAt, cost: line.unitCost });
          }
        }
      }
    }
    if (points.length < 2) continue;
    points.sort((a, b) => a.at.localeCompare(b.at));
    const previousCost = points[points.length - 2].cost;
    const latestCost = points[points.length - 1].cost;
    if (latestCost <= previousCost + 0.009) continue;
    const before = marginRatio(product.sellingPrice, previousCost);
    const after = marginRatio(product.sellingPrice, latestCost);
    if (after >= before - 0.005) continue;
    const suggested = priceToRestoreMargin(latestCost, before);
    if (suggested <= product.sellingPrice) continue;
    alerts.push({
      productId: product.id,
      productName: product.name,
      previousCost,
      latestCost,
      sellingPrice: product.sellingPrice,
      marginBefore: roundTo(before * 100, 1),
      marginAfter: roundTo(after * 100, 1),
      suggestedPrice: suggested,
      confidence: 'high',
      whyKey: 'ai.why.margin',
      whyVars: {
        name: product.name,
        latestMoney: latestCost,
        previousMoney: previousCost,
        sellingMoney: product.sellingPrice,
        before: roundTo(before * 100, 1),
        after: roundTo(after * 100, 1),
        suggestedMoney: suggested,
      },
    });
  }
  return alerts.sort((a, b) => a.marginAfter - b.marginAfter);
}

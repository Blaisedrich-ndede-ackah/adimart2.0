import { analyzeBrief } from './brief';
import { analyzePairs } from './boughtTogether';
import { analyzeCashiers } from './cashier';
import { analyzeDebt } from './debt';
import { analyzeExpiry } from './expiry';
import { analyzeHeatmap } from './heatmap';
import { analyzeMargins } from './margin';
import { analyzeRestock } from './restock';
import { historySpanDays } from './snapshot';
import { completedSales } from './snapshot';
import type { AiReport, AiSnapshot } from './types';

export interface ReportOptions {
  includeSensitive: boolean;
}

const memo = new Map<string, AiReport>();

function mix(hash: number, text: string): number {
  let next = hash;
  for (let i = 0; i < text.length; i += 1) next = (Math.imul(next, 33) + text.charCodeAt(i)) | 0;
  return next;
}

export function snapshotKey(snapshot: AiSnapshot, includeSensitive: boolean): string {
  let hash = 0;
  hash = mix(hash, snapshot.now + snapshot.storeName + (snapshot.locationId || '') + String(includeSensitive));
  hash = mix(hash, JSON.stringify(snapshot.settings));
  hash = mix(hash, (snapshot.expiringBatchIds || []).join(','));
  for (const sale of snapshot.sales) hash = mix(hash, sale.id + sale.total + sale.discount + sale.createdAt + sale.cashierId);
  for (const item of snapshot.items) hash = mix(hash, item.transactionId + item.productId + item.quantity + item.subtotal);
  for (const batch of snapshot.batches) hash = mix(hash, batch.id + batch.quantity + batch.costPrice + (batch.expiryDate || '') + batch.createdAt);
  for (const product of snapshot.products) hash = mix(hash, product.id + product.stock + product.sellingPrice + product.costPrice + product.reorderLevel);
  for (const customer of snapshot.customers) hash = mix(hash, customer.id + customer.openingRemaining);
  for (const payment of snapshot.payments) hash = mix(hash, payment.customerId + payment.createdAt + payment.amount);
  for (const order of snapshot.orders) hash = mix(hash, order.supplierId + order.status + order.createdAt);
  for (const movement of snapshot.movements) hash = mix(hash, movement.userId + movement.type + movement.createdAt);
  for (const row of snapshot.returns) hash = mix(hash, row.createdBy + row.createdAt);
  return String(hash);
}

function assemble(snapshot: AiSnapshot, options: ReportOptions): AiReport {
  const stock = analyzeExpiry(snapshot);
  const names: Record<string, string> = {};
  for (const product of snapshot.products) names[product.id] = product.name;
  return {
    generatedAt: snapshot.now,
    lowHistory: historySpanDays(snapshot) < 14 || completedSales(snapshot, null).length < 5,
    brief: analyzeBrief(snapshot, options.includeSensitive),
    expiry: stock.expiry,
    deadStock: stock.deadStock,
    restock: analyzeRestock(snapshot),
    debt: analyzeDebt(snapshot),
    cashierFlags: options.includeSensitive ? analyzeCashiers(snapshot) : [],
    margins: options.includeSensitive ? analyzeMargins(snapshot) : [],
    heatmap: analyzeHeatmap(snapshot),
    pairs: analyzePairs(snapshot),
    productNames: names,
  };
}

export function runReport(snapshot: AiSnapshot, options: ReportOptions): AiReport {
  const key = snapshotKey(snapshot, options.includeSensitive);
  const cached = memo.get(key);
  if (cached) return cached;
  const report = assemble(snapshot, options);
  memo.set(key, report);
  if (memo.size > 6) {
    const first = memo.keys().next().value;
    if (first) memo.delete(first);
  }
  return report;
}

export async function runReportBatched(
  snapshot: AiSnapshot,
  options: ReportOptions,
  pause: () => Promise<void>
): Promise<AiReport> {
  const key = snapshotKey(snapshot, options.includeSensitive);
  const cached = memo.get(key);
  if (cached) return cached;
  await pause();
  const stock = analyzeExpiry(snapshot);
  await pause();
  const restock = analyzeRestock(snapshot);
  await pause();
  const brief = analyzeBrief(snapshot, options.includeSensitive);
  await pause();
  const debt = analyzeDebt(snapshot);
  await pause();
  const cashierFlags = options.includeSensitive ? analyzeCashiers(snapshot) : [];
  await pause();
  const margins = options.includeSensitive ? analyzeMargins(snapshot) : [];
  await pause();
  const heatmap = analyzeHeatmap(snapshot);
  await pause();
  const pairs = analyzePairs(snapshot);
  const names: Record<string, string> = {};
  for (const product of snapshot.products) names[product.id] = product.name;
  const report: AiReport = {
    generatedAt: snapshot.now,
    lowHistory: historySpanDays(snapshot) < 14 || completedSales(snapshot, null).length < 5,
    brief,
    expiry: stock.expiry,
    deadStock: stock.deadStock,
    restock,
    debt,
    cashierFlags,
    margins,
    heatmap,
    pairs,
    productNames: names,
  };
  memo.set(key, report);
  return report;
}

export function clearReportMemo(): void {
  memo.clear();
}

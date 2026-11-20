import { addDays, dayKey, parseDate, roundTo, startOfLocalDay } from './dates';
import { rankCustomerDebt } from './debt';
import { analyzeExpiry } from './expiry';
import { itemsBySale, nowOf, productName } from './snapshot';
import { completedSales } from './snapshot';
import type { AiSnapshot, Brief } from './types';

function dayTotal(snapshot: AiSnapshot, ymdKey: string): { sales: number; count: number; profit: number; missingCost: boolean } {
  const sales = completedSales(snapshot).filter((sale) => dayKey(parseDate(sale.createdAt)) === ymdKey);
  const items = itemsBySale(snapshot);
  const costs = new Map(snapshot.products.map((product) => [product.id, product.costPrice]));
  let profit = 0;
  let missingCost = false;
  for (const sale of sales) {
    for (const item of items.get(sale.id) || []) {
      const cost = costs.get(item.productId);
      if (cost == null || cost <= 0) {
        missingCost = true;
        continue;
      }
      profit += item.subtotal - cost * item.quantity;
    }
  }
  return {
    sales: roundTo(sales.reduce((sum, sale) => sum + sale.total, 0), 2),
    count: sales.length,
    profit: roundTo(profit, 2),
    missingCost,
  };
}

export function analyzeBrief(snapshot: AiSnapshot, includeProfit: boolean): Brief {
  const today = startOfLocalDay(nowOf(snapshot));
  const yesterday = addDays(today, -1);
  const yesterdayKey = dayKey(yesterday);
  const previousKey = dayKey(addDays(today, -2));
  const yesterdayStats = dayTotal(snapshot, yesterdayKey);
  const previousStats = dayTotal(snapshot, previousKey);
  const history = completedSales(snapshot);
  let weekSum = 0;
  for (let offset = 2; offset <= 8; offset += 1) {
    weekSum += dayTotal(snapshot, dayKey(addDays(today, -offset))).sales;
  }
  const weekAverage = roundTo(weekSum / 7, 2);
  const enough = history.length >= 5;
  const confidence: Brief['confidence'] = !enough ? 'low' : yesterdayStats.missingCost ? 'medium' : 'high';
  const expiry = analyzeExpiry(snapshot);
  const lowStock = snapshot.products.filter((product) => {
    if (!product.active) return false;
    const threshold = product.reorderLevel > 0 ? product.reorderLevel : 5;
    return product.stock > 0 && product.stock <= threshold;
  }).length;
  const debtors = rankCustomerDebt(snapshot).slice(0, 3).map((row) => ({
    customerId: row.customerId,
    name: row.name,
    owed: row.owed,
  }));
  const itemQty = new Map<string, { qty: number; sales: number }>();
  const ySales = new Set(
    completedSales(snapshot).filter((sale) => dayKey(parseDate(sale.createdAt)) === yesterdayKey).map((sale) => sale.id)
  );
  for (const item of snapshot.items) {
    if (!ySales.has(item.transactionId)) continue;
    const current = itemQty.get(item.productId) || { qty: 0, sales: 0 };
    current.qty += item.quantity;
    current.sales += item.subtotal;
    itemQty.set(item.productId, current);
  }
  const topItems = [...itemQty.entries()]
    .sort((a, b) => b[1].sales - a[1].sales)
    .slice(0, 3)
    .map(([productId, stats]) => ({
      productId,
      name: productName(snapshot, productId),
      qty: stats.qty,
      sales: roundTo(stats.sales, 2),
    }));
  return {
    enoughHistory: enough,
    sales: yesterdayStats.sales,
    saleCount: yesterdayStats.count,
    profit: includeProfit ? yesterdayStats.profit : null,
    topItems,
    lowStock,
    expiring: expiry.expiry.length,
    topDebtors: debtors,
    previousDaySales: previousStats.sales,
    weekAverageSales: weekAverage,
    confidence,
    whyKey: enough ? 'ai.why.brief' : 'ai.why.briefLow',
    whyVars: {
      salesCount: yesterdayStats.count,
      prevMoney: previousStats.sales,
      weekMoney: weekAverage,
      salesMoney: yesterdayStats.sales,
    },
  };
}

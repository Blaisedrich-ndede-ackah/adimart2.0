/**
 * Consolidated view across every store linked to this device.
 *
 * Owners who run more than one shop get one screen that adds up today's
 * takings, this month's profit, outstanding customer credit and low stock
 * across all of them.
 *
 * Everything is read from the local database, so the screen keeps working
 * offline; the numbers catch up as each store syncs.
 */

import { db, type LocalStore } from '@/lib/dexie';
import { buildCustomerBalances } from '@/lib/customerBalances';
import { lineBaseQty, roundMoney } from '@/lib/money';
import { toQty } from '@/lib/warehouse';

export interface ConsolidatedStoreSummary {
  storeId: string;
  name: string;
  address: string;
  supportNumber: string;
  currencyCode: string;
  isCurrent: boolean;
  todaySales: number;
  todayCash: number;
  todayNonCash: number;
  todayTransactions: number;
  todayExpenses: number;
  monthSales: number;
  monthCostOfGoods: number;
  monthExpenses: number;
  monthNetProfit: number;
  outstandingCredit: number;
  lowStockCount: number;
  productCount: number;
  lastSaleAt: string | null;
}

export interface ConsolidatedTotals {
  storeCount: number;
  todaySales: number;
  todayCash: number;
  todayNonCash: number;
  todayTransactions: number;
  todayExpenses: number;
  monthSales: number;
  monthCostOfGoods: number;
  monthExpenses: number;
  monthNetProfit: number;
  outstandingCredit: number;
  lowStockCount: number;
  productCount: number;
}

export interface ConsolidatedSummary {
  stores: ConsolidatedStoreSummary[];
  totals: ConsolidatedTotals;
  generatedAt: string;
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function startOfMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): ConsolidatedTotals {
  return {
    storeCount: 0,
    todaySales: 0,
    todayCash: 0,
    todayNonCash: 0,
    todayTransactions: 0,
    todayExpenses: 0,
    monthSales: 0,
    monthCostOfGoods: 0,
    monthExpenses: 0,
    monthNetProfit: 0,
    outstandingCredit: 0,
    lowStockCount: 0,
    productCount: 0,
  };
}

/** Build the consolidated numbers for one store. */
export async function buildStoreSummary(
  store: LocalStore,
  currentStoreId: string | null
): Promise<ConsolidatedStoreSummary> {
  const todayStart = startOfToday();
  const monthStart = startOfMonth();

  const [transactions, items, expenses, products, balances] = await Promise.all([
    db.transactions.where('store_id').equals(store.id).toArray(),
    db.transaction_items.where('store_id').equals(store.id).toArray(),
    db.expenses.where('store_id').equals(store.id).toArray(),
    db.products.where('store_id').equals(store.id).toArray(),
    buildCustomerBalances(store.id),
  ]);

  const productCost = new Map(products.map((product) => [product.id, toNumber(product.cost_price)]));

  let todaySales = 0;
  let todayCash = 0;
  let todayNonCash = 0;
  let todayTransactions = 0;
  let todayExpenses = 0;
  let monthSales = 0;
  let monthCostOfGoods = 0;
  let monthExpenses = 0;
  let lastSaleAt: string | null = null;

  const monthTransactionIds = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.status !== 'completed') continue;
    const created = new Date(transaction.created_at).getTime();
    if (Number.isFinite(created) && (!lastSaleAt || created > new Date(lastSaleAt).getTime())) {
      lastSaleAt = transaction.created_at;
    }
    const amount = toNumber(transaction.total_amount);
    if (created >= todayStart) {
      todaySales += amount;
      todayCash += toNumber(transaction.cash_amount);
      todayNonCash +=
        toNumber(transaction.paystack_amount) + toNumber(transaction.manual_payment_amount);
      todayTransactions += 1;
    }
    if (created >= monthStart) {
      monthSales += amount;
      monthTransactionIds.add(transaction.id);
    }
  }

  for (const item of items) {
    if (!monthTransactionIds.has(item.transaction_id)) continue;
    monthCostOfGoods += (productCost.get(item.product_id) ?? 0) * lineBaseQty(item);
  }

  for (const expense of expenses) {
    const created = new Date(expense.created_at).getTime();
    const amount = toNumber(expense.amount);
    if (created >= todayStart) todayExpenses += amount;
    if (created >= monthStart) monthExpenses += amount;
  }

  let outstandingCredit = 0;
  for (const balance of balances.values()) {
    outstandingCredit += balance.total;
  }

  const activeProducts = products.filter((product) => product.is_active === 1);
  const lowStockCount = activeProducts.filter((product) => {
    const reorderLevel = toNumber(product.reorder_level);
    const threshold = reorderLevel > 0 ? reorderLevel : 5;
    return toQty(product.stock_level) <= threshold;
  }).length;

  return {
    storeId: store.id,
    name: store.name,
    address: store.address || '',
    supportNumber: store.support_number || '',
    currencyCode: store.currency_code || 'GHS',
    isCurrent: store.id === currentStoreId,
    todaySales: roundMoney(todaySales),
    todayCash: roundMoney(todayCash),
    todayNonCash: roundMoney(todayNonCash),
    todayTransactions,
    todayExpenses: roundMoney(todayExpenses),
    monthSales: roundMoney(monthSales),
    monthCostOfGoods: roundMoney(monthCostOfGoods),
    monthExpenses: roundMoney(monthExpenses),
    monthNetProfit: roundMoney(monthSales - monthCostOfGoods - monthExpenses),
    outstandingCredit: roundMoney(outstandingCredit),
    lowStockCount,
    productCount: activeProducts.length,
    lastSaleAt,
  };
}

/**
 * Consolidated numbers for every linked store.
 *
 * `stores` should be the stores the owner controls on this device; the
 * current store is always included even if it is not in the list.
 */
export async function buildConsolidatedSummary(
  stores: LocalStore[],
  currentStoreId: string | null
): Promise<ConsolidatedSummary> {
  const unique = new Map<string, LocalStore>();
  for (const store of stores) {
    if (store?.id) unique.set(store.id, store);
  }
  if (currentStoreId && !unique.has(currentStoreId)) {
    const current = await db.stores.get(currentStoreId);
    if (current) unique.set(current.id, current);
  }

  const summaries: ConsolidatedStoreSummary[] = [];
  for (const store of Array.from(unique.values())) {
    summaries.push(await buildStoreSummary(store, currentStoreId));
  }
  summaries.sort((a, b) => b.todaySales - a.todaySales);

  const totals = emptyTotals();
  totals.storeCount = summaries.length;
  for (const summary of summaries) {
    totals.todaySales += summary.todaySales;
    totals.todayCash += summary.todayCash;
    totals.todayNonCash += summary.todayNonCash;
    totals.todayTransactions += summary.todayTransactions;
    totals.todayExpenses += summary.todayExpenses;
    totals.monthSales += summary.monthSales;
    totals.monthCostOfGoods += summary.monthCostOfGoods;
    totals.monthExpenses += summary.monthExpenses;
    totals.monthNetProfit += summary.monthNetProfit;
    totals.outstandingCredit += summary.outstandingCredit;
    totals.lowStockCount += summary.lowStockCount;
    totals.productCount += summary.productCount;
  }
  totals.todaySales = roundMoney(totals.todaySales);
  totals.todayCash = roundMoney(totals.todayCash);
  totals.todayNonCash = roundMoney(totals.todayNonCash);
  totals.todayExpenses = roundMoney(totals.todayExpenses);
  totals.monthSales = roundMoney(totals.monthSales);
  totals.monthCostOfGoods = roundMoney(totals.monthCostOfGoods);
  totals.monthExpenses = roundMoney(totals.monthExpenses);
  totals.monthNetProfit = roundMoney(totals.monthNetProfit);
  totals.outstandingCredit = roundMoney(totals.outstandingCredit);

  return { stores: summaries, totals, generatedAt: new Date().toISOString() };
}

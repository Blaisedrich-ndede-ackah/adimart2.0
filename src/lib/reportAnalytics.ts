import {
  db,
  LocalExpense,
  LocalLocation,
  LocalTransaction,
} from './dexie';
import { FormalPdf, formatGhsOfficial, orgFromStore, type FormalOrg } from './formalPdf';
import { getLocationInventory, listLocations, toMoney, toQty } from './warehouse';
import { lineBaseQty, roundMoney } from './money';

export interface PeriodRange {
  start: Date;
  end: Date;
}

export interface ProductSalesStat {
  product_id: string;
  product_name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface CategorySalesStat {
  category: string;
  revenue: number;
  quantity: number;
  profit: number;
}

export interface CashierSalesStat {
  cashier_id: string;
  cashier_name: string;
  transactions: number;
  revenue: number;
}

export interface ReportSummary {
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  transactionCount: number;
  topProducts: ProductSalesStat[];
  slowProducts: ProductSalesStat[];
  categories: CategorySalesStat[];
  cashiers: CashierSalesStat[];
}

export type ReportPeriodPreset = 'today' | 'week' | 'month';
export type ReportPeriod = ReportPeriodPreset | 'custom';

function parseDateOnlyStart(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function parseDateOnlyEnd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

/** Inclusive From → To range from YYYY-MM-DD strings. */
export function getCustomDateRange(fromDate: string, toDate: string): PeriodRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('Choose valid From and To dates.');
  }
  if (fromDate > toDate) {
    throw new Error('From date must be on or before the To date.');
  }
  return {
    start: parseDateOnlyStart(fromDate),
    end: parseDateOnlyEnd(toDate),
  };
}

export function getPeriodRange(period: ReportPeriodPreset): PeriodRange {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (period) {
    case 'today':
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0), end };
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0), end };
  }
}

export function resolveReportRange(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string
): PeriodRange {
  if (period === 'custom') {
    return getCustomDateRange(customFrom || '', customTo || '');
  }
  return getPeriodRange(period);
}

export function formatReportPeriodLabel(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string
): string {
  if (period === 'custom' && customFrom && customTo) {
    return `${customFrom} → ${customTo}`;
  }
  if (period === 'today') return 'Today';
  if (period === 'week') return 'This Week';
  if (period === 'month') return 'This Month';
  return 'Custom range';
}

export async function buildReportSummary(
  storeId: string,
  range: PeriodRange
): Promise<ReportSummary> {
  const { start, end } = range;

  const [transactions, items, products, expenses] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.products.where('store_id').equals(storeId).toArray(),
    db.expenses.where('store_id').equals(storeId).toArray(),
  ]);

  const periodTxns = transactions.filter(t => {
    const d = new Date(t.created_at);
    return t.status === 'completed' && d >= start && d <= end;
  });

  const txnIds = new Set(periodTxns.map(t => t.id));
  const periodItems = items.filter(i => txnIds.has(i.transaction_id));
  const productMap = new Map(products.map(p => [p.id, p]));

  const productStats = new Map<string, ProductSalesStat>();

  for (const item of periodItems) {
    const product = productMap.get(item.product_id);
    const unitCost = product?.cost_price ?? 0;
    const baseQty = lineBaseQty(item);
    const existing = productStats.get(item.product_id) || {
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    };

    existing.quantity += baseQty;
    existing.revenue += roundMoney(item.subtotal);
    existing.cost += roundMoney(unitCost * baseQty);
    existing.profit = roundMoney(existing.revenue - existing.cost);
    productStats.set(item.product_id, existing);
  }

  const allProductStats = [...productStats.values()].sort((a, b) => b.revenue - a.revenue);
  const topProducts = allProductStats.slice(0, 5);
  const slowProducts = [...allProductStats].sort((a, b) => a.quantity - b.quantity).slice(0, 5);

  const categoryStats = new Map<string, CategorySalesStat>();
  for (const stat of allProductStats) {
    const product = productMap.get(stat.product_id);
    const category = product?.category || 'Other';
    const existing = categoryStats.get(category) || {
      category,
      revenue: 0,
      quantity: 0,
      profit: 0,
    };
    existing.revenue += stat.revenue;
    existing.quantity += stat.quantity;
    existing.profit += stat.profit;
    categoryStats.set(category, existing);
  }

  const cashierStats = new Map<string, CashierSalesStat>();
  for (const txn of periodTxns) {
    const existing = cashierStats.get(txn.cashier_id) || {
      cashier_id: txn.cashier_id,
      cashier_name: txn.cashier_name,
      transactions: 0,
      revenue: 0,
    };
    existing.transactions += 1;
    existing.revenue = roundMoney(existing.revenue + txn.total_amount);
    cashierStats.set(txn.cashier_id, existing);
  }

  const revenue = roundMoney(periodTxns.reduce((sum, t) => sum + t.total_amount, 0));
  const costOfGoods = roundMoney(
    periodItems.reduce((sum, item) => {
      const product = productMap.get(item.product_id);
      return sum + (product?.cost_price ?? 0) * lineBaseQty(item);
    }, 0)
  );

  const periodExpenses = roundMoney(
    expenses
      .filter(e => {
        const d = new Date(e.created_at);
        return d >= start && d <= end;
      })
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  );

  const grossProfit = roundMoney(revenue - costOfGoods);
  const netProfit = grossProfit - periodExpenses;

  return {
    revenue,
    costOfGoods,
    grossProfit,
    expenses: periodExpenses,
    netProfit,
    transactionCount: periodTxns.length,
    topProducts,
    slowProducts,
    categories: [...categoryStats.values()].sort((a, b) => b.revenue - a.revenue),
    cashiers: [...cashierStats.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

export function exportReportCsv(
  summary: ReportSummary,
  periodLabel: string,
  storeName: string,
  transactions: LocalTransaction[],
  expenses: LocalExpense[]
): void {
  const lines: string[] = [
    `Adimat POS Report - ${storeName}`,
    `Period,${periodLabel}`,
    '',
    'Summary',
    `Revenue,${summary.revenue.toFixed(2)}`,
    `Cost of Goods,${summary.costOfGoods.toFixed(2)}`,
    `Gross Profit,${summary.grossProfit.toFixed(2)}`,
    `Expenses,${summary.expenses.toFixed(2)}`,
    `Net Profit,${summary.netProfit.toFixed(2)}`,
    `Transactions,${summary.transactionCount}`,
    '',
    'Top Products,Quantity,Revenue,Profit',
    ...summary.topProducts.map(p =>
      `"${p.product_name}",${p.quantity},${p.revenue.toFixed(2)},${p.profit.toFixed(2)}`
    ),
    '',
    'Sales by Category,Quantity,Revenue,Profit',
    ...summary.categories.map(c =>
      `"${c.category}",${c.quantity},${c.revenue.toFixed(2)},${c.profit.toFixed(2)}`
    ),
    '',
    'Sales by Cashier,Transactions,Revenue',
    ...summary.cashiers.map(c =>
      `"${c.cashier_name}",${c.transactions},${c.revenue.toFixed(2)}`
    ),
    '',
    'Expenses,Category,Amount,Date',
    ...expenses.map(e =>
      `"${e.description}","${e.category}",${e.amount.toFixed(2)},${new Date(e.created_at).toLocaleDateString()}`
    ),
    '',
    'Transactions,Receipt,Cashier,Total,Payment,Date',
    ...transactions.map(t =>
      `${t.id},"${t.receipt_number}","${t.cashier_name}",${t.total_amount.toFixed(2)},${t.payment_method},${t.created_at}`
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `adimat-report-${periodLabel.toLowerCase().replace(/\s+/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportReportPdf(
  summary: ReportSummary,
  periodLabel: string,
  storeName: string,
  org?: FormalOrg
): void {
  const letterhead = org || orgFromStore({ name: storeName });
  const money = (n: number) => formatGhsOfficial(n, letterhead.currencyCode);
  const pdf = new FormalPdf(letterhead, {
    title: 'Management report',
    subtitle: storeName,
    period: `Reporting period: ${periodLabel}`,
    documentLabel: 'OFFICIAL REPORT',
    notes: [
      'This report summarises completed point-of-sale transactions and recorded operating expenses for the selected period.',
      'Cost of goods is estimated from product cost prices. Figures are management accounts and are not audited.',
    ],
  });

  pdf.section('Financial summary');
  pdf.kvTable([
    { label: 'Sales revenue', value: money(summary.revenue) },
    { label: 'Cost of goods sold', value: money(summary.costOfGoods) },
    { label: 'Gross profit', value: money(summary.grossProfit), emphasis: 'subtotal' },
    { label: 'Operating expenses', value: money(summary.expenses) },
    { label: 'Net profit', value: money(summary.netProfit), emphasis: 'total' },
    { label: 'Completed transactions', value: String(summary.transactionCount), emphasis: 'muted' },
  ]);

  if (summary.topProducts.length > 0) {
    pdf.section('Top products');
    pdf.dataTable(
      ['Product', 'Qty', 'Revenue', 'Profit'],
      summary.topProducts.map((p) => [
        p.product_name,
        String(p.quantity),
        money(p.revenue),
        money(p.profit),
      ]),
      [4, 1, 2, 2]
    );
  }

  if (summary.categories.length > 0) {
    pdf.section('Sales by category');
    pdf.dataTable(
      ['Category', 'Qty', 'Revenue', 'Profit'],
      summary.categories.map((c) => [
        c.category,
        String(c.quantity),
        money(c.revenue),
        money(c.profit),
      ]),
      [4, 1, 2, 2]
    );
  }

  if (summary.cashiers.length > 0) {
    pdf.section('Sales by cashier');
    pdf.dataTable(
      ['Cashier', 'Transactions', 'Revenue'],
      summary.cashiers.map((c) => [
        c.cashier_name,
        String(c.transactions),
        money(c.revenue),
      ]),
      [4, 2, 2]
    );
  }

  pdf.signatureBlock('Prepared by', 'Reviewed by');
  pdf.save(`${safeFilePart(storeName)}-report-${periodLabel.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
}

export interface LocationReportSummary {
  location: LocalLocation;
  storeName: string;
  period: ReportPeriod | 'all';
  periodLabel: string;
  /** Sales at this location */
  costPrice: number;
  sellingPrice: number;
  profitEstimate: number;
  transactionCount: number;
  topProducts: ProductSalesStat[];
  /** On-hand inventory valuation at this location */
  stockUnits: number;
  stockSkuCount: number;
  stockCostValue: number;
  stockSellingValue: number;
  stockProfitEstimate: number;
}

/**
 * Build an individual shop/warehouse report:
 * - sales metrics for transactions at this location
 * - on-hand stock valuation (cost / selling / profit estimate)
 */
export async function buildLocationReportSummary(
  storeId: string,
  locationId: string,
  range: PeriodRange | null,
  storeName = 'Store',
  periodLabel = 'Custom range',
  period: ReportPeriod | 'all' = 'custom'
): Promise<LocationReportSummary> {
  const locations = await listLocations(storeId);
  const location = locations.find((l) => l.id === locationId);
  if (!location) throw new Error('Location not found');

  const [transactions, items, products, inventory] = await Promise.all([
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.products.where('store_id').equals(storeId).toArray(),
    getLocationInventory(storeId, locationId),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  let periodTxns = transactions.filter(
    (t) => t.status === 'completed' && t.location_id === locationId
  );

  if (range) {
    const { start, end } = range;
    periodTxns = periodTxns.filter((t) => {
      const d = new Date(t.created_at);
      return d >= start && d <= end;
    });
  }

  const txnIds = new Set(periodTxns.map((t) => t.id));
  const periodItems = items.filter((i) => txnIds.has(i.transaction_id));

  const productStats = new Map<string, ProductSalesStat>();
  for (const item of periodItems) {
    const product = productMap.get(item.product_id);
    const unitCost = product?.cost_price ?? 0;
    const existing = productStats.get(item.product_id) || {
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    };
    existing.quantity += lineBaseQty(item);
    existing.revenue += roundMoney(item.subtotal);
    existing.cost += roundMoney(unitCost * lineBaseQty(item));
    existing.profit = roundMoney(existing.revenue - existing.cost);
    productStats.set(item.product_id, existing);
  }

  const sellingPrice = roundMoney(periodItems.reduce((sum, i) => sum + i.subtotal, 0));
  const costPrice = roundMoney(
    periodItems.reduce((sum, item) => {
      const product = productMap.get(item.product_id);
      return sum + (product?.cost_price ?? 0) * lineBaseQty(item);
    }, 0)
  );
  const profitEstimate = sellingPrice - costPrice;

  let stockUnits = 0;
  let stockCostValue = 0;
  let stockSellingValue = 0;
  for (const row of inventory) {
    const qty = toQty(row.quantity);
    stockUnits += qty;
    stockCostValue += toMoney(row.product.cost_price) * qty;
    stockSellingValue += toMoney(row.product.selling_price) * qty;
  }

  return {
    location,
    storeName,
    period,
    periodLabel,
    costPrice,
    sellingPrice,
    profitEstimate,
    transactionCount: periodTxns.length,
    topProducts: [...productStats.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    stockUnits,
    stockSkuCount: inventory.length,
    stockCostValue,
    stockSellingValue,
    stockProfitEstimate: stockSellingValue - stockCostValue,
  };
}

export function exportLocationReportCsv(summary: LocationReportSummary): void {
  const locLabel = `${summary.location.name} (${summary.location.location_type})`;
  const lines: string[] = [
    `Adimat Location Report - ${summary.storeName}`,
    `Location,${locLabel}`,
    `Period,${summary.periodLabel}`,
    '',
    'Sales financials',
    `Cost price,${summary.costPrice.toFixed(2)}`,
    `Selling price,${summary.sellingPrice.toFixed(2)}`,
    `Profit Estimate,${summary.profitEstimate.toFixed(2)}`,
    `Transactions,${summary.transactionCount}`,
    '',
    'Stock valuation (on hand)',
    `SKUs,${summary.stockSkuCount}`,
    `Units,${summary.stockUnits}`,
    `Stock cost value,${summary.stockCostValue.toFixed(2)}`,
    `Stock selling value,${summary.stockSellingValue.toFixed(2)}`,
    `Stock profit estimate,${summary.stockProfitEstimate.toFixed(2)}`,
    '',
    'Top products at location,Quantity,Revenue,Cost,Profit',
    ...summary.topProducts.map(
      (p) =>
        `"${p.product_name}",${p.quantity},${p.revenue.toFixed(2)},${p.cost.toFixed(2)},${p.profit.toFixed(2)}`
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = summary.location.name.toLowerCase().replace(/\s+/g, '-');
  link.download = `adimat-${summary.location.location_type}-${safeName}-${summary.periodLabel.toLowerCase().replace(/\s+/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportLocationReportPdf(summary: LocationReportSummary, org?: FormalOrg): void {
  const locLabel = `${summary.location.name} (${summary.location.location_type})`;
  const letterhead = org || orgFromStore({ name: summary.storeName });
  const money = (n: number) => formatGhsOfficial(n, letterhead.currencyCode);
  const pdf = new FormalPdf(letterhead, {
    title: 'Location report',
    subtitle: `${summary.storeName} — ${locLabel}`,
    period: `Reporting period: ${summary.periodLabel}`,
    documentLabel: 'OFFICIAL REPORT',
    notes: [
      'Sales figures cover completed transactions recorded at this location for the selected period.',
      'Stock valuation is the on-hand inventory at the time of this report, at cost and selling price.',
    ],
  });

  pdf.section('Sales financials');
  pdf.kvTable([
    { label: 'Cost of goods sold', value: money(summary.costPrice) },
    { label: 'Selling value', value: money(summary.sellingPrice) },
    { label: 'Profit estimate', value: money(summary.profitEstimate), emphasis: 'total' },
    { label: 'Completed transactions', value: String(summary.transactionCount), emphasis: 'muted' },
  ]);

  pdf.section('Stock valuation (on hand)');
  pdf.kvTable([
    { label: 'SKUs', value: String(summary.stockSkuCount) },
    { label: 'Units on hand', value: String(summary.stockUnits) },
    { label: 'Stock at cost', value: money(summary.stockCostValue) },
    { label: 'Stock at selling price', value: money(summary.stockSellingValue) },
    {
      label: 'Unrealised profit estimate',
      value: money(summary.stockProfitEstimate),
      emphasis: 'total',
    },
  ]);

  if (summary.topProducts.length > 0) {
    pdf.section('Top products at this location');
    pdf.dataTable(
      ['Product', 'Qty', 'Revenue', 'Profit'],
      summary.topProducts.map((p) => [
        p.product_name,
        String(p.quantity),
        money(p.revenue),
        money(p.profit),
      ]),
      [4, 1, 2, 2]
    );
  }

  pdf.signatureBlock('Prepared by', 'Location supervisor');
  const safeName = summary.location.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  pdf.save(
    `${safeFilePart(summary.storeName)}-${summary.location.location_type}-${safeName}-${summary.periodLabel.toLowerCase().replace(/\s+/g, '-')}.pdf`
  );
}

export async function listReportLocations(storeId: string): Promise<LocalLocation[]> {
  return listLocations(storeId);
}

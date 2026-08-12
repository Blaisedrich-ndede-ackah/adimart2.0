import jsPDF from 'jspdf';
import {
  db,
  LocalExpense,
  LocalLocation,
  LocalTransaction,
} from './dexie';
import { getLocationInventory, listLocations } from './warehouse';

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
    const existing = productStats.get(item.product_id) || {
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    };

    existing.quantity += item.quantity;
    existing.revenue += item.subtotal;
    existing.cost += unitCost * item.quantity;
    existing.profit = existing.revenue - existing.cost;
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
    existing.revenue += txn.total_amount;
    cashierStats.set(txn.cashier_id, existing);
  }

  const revenue = periodTxns.reduce((sum, t) => sum + t.total_amount, 0);
  const costOfGoods = periodItems.reduce((sum, item) => {
    const product = productMap.get(item.product_id);
    return sum + (product?.cost_price ?? 0) * item.quantity;
  }, 0);

  const periodExpenses = expenses
    .filter(e => {
      const d = new Date(e.created_at);
      return d >= start && d <= end;
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const grossProfit = revenue - costOfGoods;
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
  storeName: string
): void {
  const doc = new jsPDF();
  let y = 14;

  const line = (left: string, right = '') => {
    doc.setFontSize(10);
    doc.text(left, 14, y);
    if (right) doc.text(right, 196, y, { align: 'right' });
    y += 6;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Adimat POS Report', 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(`${storeName} • ${periodLabel}`, 14, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  line('Revenue', `GH₵${summary.revenue.toFixed(2)}`);
  line('Cost of Goods', `GH₵${summary.costOfGoods.toFixed(2)}`);
  line('Gross Profit', `GH₵${summary.grossProfit.toFixed(2)}`);
  line('Expenses', `GH₵${summary.expenses.toFixed(2)}`);
  line('Net Profit', `GH₵${summary.netProfit.toFixed(2)}`);
  line('Transactions', String(summary.transactionCount));
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text('Top Products', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  summary.topProducts.forEach(p => {
    line(`${p.product_name} (${p.quantity})`, `GH₵${p.revenue.toFixed(2)}`);
  });

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('Sales by Category', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  summary.categories.forEach(c => {
    line(c.category, `GH₵${c.revenue.toFixed(2)}`);
  });

  doc.save(`adimat-report-${periodLabel.toLowerCase().replace(/\s+/g, '-')}.pdf`);
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
    existing.quantity += item.quantity;
    existing.revenue += item.subtotal;
    existing.cost += unitCost * item.quantity;
    existing.profit = existing.revenue - existing.cost;
    productStats.set(item.product_id, existing);
  }

  const sellingPrice = periodItems.reduce((sum, i) => sum + i.subtotal, 0);
  const costPrice = periodItems.reduce((sum, item) => {
    const product = productMap.get(item.product_id);
    return sum + (product?.cost_price ?? 0) * item.quantity;
  }, 0);
  const profitEstimate = sellingPrice - costPrice;

  let stockUnits = 0;
  let stockCostValue = 0;
  let stockSellingValue = 0;
  for (const row of inventory) {
    stockUnits += row.quantity;
    stockCostValue += (row.product.cost_price || 0) * row.quantity;
    stockSellingValue += (row.product.selling_price || 0) * row.quantity;
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

export function exportLocationReportPdf(summary: LocationReportSummary): void {
  const doc = new jsPDF();
  let y = 14;
  const line = (left: string, right = '') => {
    doc.setFontSize(10);
    doc.text(left, 14, y);
    if (right) doc.text(right, 196, y, { align: 'right' });
    y += 6;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Adimat Location Report', 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(`${summary.storeName}`, 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${summary.location.name} (${summary.location.location_type}) • ${summary.periodLabel}`,
    14,
    y
  );
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.text('Sales financials', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  line('Cost price', `GHS ${summary.costPrice.toFixed(2)}`);
  line('Selling price', `GHS ${summary.sellingPrice.toFixed(2)}`);
  line('Profit Estimate', `GHS ${summary.profitEstimate.toFixed(2)}`);
  line('Transactions', String(summary.transactionCount));
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text('Stock valuation (on hand)', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  line('SKUs', String(summary.stockSkuCount));
  line('Units', String(summary.stockUnits));
  line('Stock cost value', `GHS ${summary.stockCostValue.toFixed(2)}`);
  line('Stock selling value', `GHS ${summary.stockSellingValue.toFixed(2)}`);
  line('Stock profit estimate', `GHS ${summary.stockProfitEstimate.toFixed(2)}`);
  y += 4;

  if (summary.topProducts.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.text('Top products', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    summary.topProducts.forEach((p) => {
      line(`${p.product_name} (${p.quantity})`, `GHS ${p.revenue.toFixed(2)}`);
      if (y > 280) {
        doc.addPage();
        y = 14;
      }
    });
  }

  const safeName = summary.location.name.toLowerCase().replace(/\s+/g, '-');
  doc.save(
    `adimat-${summary.location.location_type}-${safeName}-${summary.periodLabel.toLowerCase().replace(/\s+/g, '-')}.pdf`
  );
}

export async function listReportLocations(storeId: string): Promise<LocalLocation[]> {
  return listLocations(storeId);
}

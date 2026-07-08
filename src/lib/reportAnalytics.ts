import jsPDF from 'jspdf';
import { db, LocalExpense, LocalProduct, LocalTransaction, LocalTransactionItem } from './dexie';

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

export function getPeriodRange(period: 'today' | 'week' | 'month'): PeriodRange {
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

export async function buildReportSummary(
  storeId: string,
  period: 'today' | 'week' | 'month'
): Promise<ReportSummary> {
  const { start, end } = getPeriodRange(period);

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

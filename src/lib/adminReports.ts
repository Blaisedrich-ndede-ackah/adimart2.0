import jsPDF from 'jspdf';
import { isSupabaseConfigured, supabase } from './supabase';
import { formatGhs } from './adminPortal';

export interface AdminStorePeriodStats {
  storeId: string;
  storeName: string;
  sales: number;
  revenue: number;
  cashRevenue: number;
  paystackRevenue: number;
  expenses: number;
  expenseCount: number;
}

export interface AdminSystemReport {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  totals: {
    stores: number;
    storesWithActivity: number;
    sales: number;
    revenue: number;
    cashRevenue: number;
    paystackRevenue: number;
    expenses: number;
    expenseCount: number;
    users: number;
    products: number;
  };
  byStore: AdminStorePeriodStats[];
}

async function fetchAllRows<T>(table: string, select = '*'): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: T[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const chunk = (data || []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function inDateRange(iso: string, fromDate: string, toDate: string): boolean {
  const day = (iso || '').slice(0, 10);
  if (!day) return false;
  return day >= fromDate && day <= toDate;
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Build a whole-platform sales/expense report for an inclusive from→to date range. */
export async function buildAdminSystemReport(
  fromDate: string,
  toDate: string
): Promise<AdminSystemReport> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY so the admin portal can load cloud data.'
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('Choose valid From and To dates.');
  }
  if (fromDate > toDate) {
    throw new Error('From date must be on or before the To date.');
  }

  const [storesRaw, usersRaw, productsRaw, txRaw, expensesRaw] = await Promise.all([
    fetchAllRows<Record<string, unknown>>('stores', 'id, name'),
    fetchAllRows<Record<string, unknown>>('users', 'id'),
    fetchAllRows<Record<string, unknown>>('products', 'id'),
    fetchAllRows<Record<string, unknown>>(
      'transactions',
      'id, store_id, total_amount, cash_amount, paystack_amount, status, created_at'
    ),
    fetchAllRows<Record<string, unknown>>('expenses', 'id, store_id, amount, created_at').catch(
      () => [] as Record<string, unknown>[]
    ),
  ]);

  const stores = storesRaw.map((s) => ({
    id: String(s.id),
    name: String(s.name || 'Unnamed store'),
  }));

  const periodTx = txRaw.filter(
    (t) =>
      String(t.status || 'completed') === 'completed' &&
      inDateRange(String(t.created_at || ''), fromDate, toDate)
  );

  const periodExpenses = expensesRaw.filter((e) =>
    inDateRange(String(e.created_at || ''), fromDate, toDate)
  );

  const byStore: AdminStorePeriodStats[] = stores
    .map((store) => {
      const storeTx = periodTx.filter((t) => String(t.store_id) === store.id);
      const storeExp = periodExpenses.filter((e) => String(e.store_id) === store.id);
      return {
        storeId: store.id,
        storeName: store.name,
        sales: storeTx.length,
        revenue: storeTx.reduce((s, t) => s + (Number(t.total_amount) || 0), 0),
        cashRevenue: storeTx.reduce((s, t) => s + (Number(t.cash_amount) || 0), 0),
        paystackRevenue: storeTx.reduce((s, t) => s + (Number(t.paystack_amount) || 0), 0),
        expenses: storeExp.reduce((s, e) => s + (Number(e.amount) || 0), 0),
        expenseCount: storeExp.length,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.storeName.localeCompare(b.storeName));

  const totals = {
    stores: stores.length,
    storesWithActivity: byStore.filter(
      (s) => s.sales > 0 || s.expenseCount > 0
    ).length,
    sales: periodTx.length,
    revenue: byStore.reduce((s, row) => s + row.revenue, 0),
    cashRevenue: byStore.reduce((s, row) => s + row.cashRevenue, 0),
    paystackRevenue: byStore.reduce((s, row) => s + row.paystackRevenue, 0),
    expenses: byStore.reduce((s, row) => s + row.expenses, 0),
    expenseCount: periodExpenses.length,
    users: usersRaw.length,
    products: productsRaw.length,
  };

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    totals,
    byStore,
  };
}

export function exportAdminSystemReportCsv(report: AdminSystemReport): void {
  const periodLabel = `${report.fromDate} to ${report.toDate}`;
  const lines = [
    'Adimat Admin — Whole System Report',
    `Period,${periodLabel}`,
    `Generated,${report.generatedAt}`,
    '',
    'Platform totals',
    `Stores,${report.totals.stores}`,
    `Stores with activity,${report.totals.storesWithActivity}`,
    `Users (snapshot),${report.totals.users}`,
    `Products (snapshot),${report.totals.products}`,
    `Sales,${report.totals.sales}`,
    `Revenue,${report.totals.revenue.toFixed(2)}`,
    `Cash revenue,${report.totals.cashRevenue.toFixed(2)}`,
    `Paystack revenue,${report.totals.paystackRevenue.toFixed(2)}`,
    `Expenses,${report.totals.expenses.toFixed(2)}`,
    `Expense entries,${report.totals.expenseCount}`,
    '',
    'Store,Sales,Revenue,Cash,Paystack,Expenses,Expense entries',
    ...report.byStore.map(
      (row) =>
        `"${row.storeName.replace(/"/g, '""')}",${row.sales},${row.revenue.toFixed(2)},${row.cashRevenue.toFixed(2)},${row.paystackRevenue.toFixed(2)},${row.expenses.toFixed(2)},${row.expenseCount}`
    ),
  ];

  downloadTextFile(
    `adimat-system-report-${report.fromDate}-to-${report.toDate}.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8;'
  );
}

export function exportAdminSystemReportPdf(report: AdminSystemReport): void {
  const doc = new jsPDF();
  let y = 14;
  const periodLabel = `${report.fromDate} → ${report.toDate}`;

  const ensureSpace = (needed = 10) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 14;
    }
  };

  const line = (left: string, right = '') => {
    ensureSpace();
    doc.setFontSize(10);
    doc.text(left, 14, y);
    if (right) doc.text(right, 196, y, { align: 'right' });
    y += 6;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Adimat Admin — Whole System Report', 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(periodLabel, 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString()}`, 14, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Platform totals', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');

  line('Stores', String(report.totals.stores));
  line('Stores with activity', String(report.totals.storesWithActivity));
  line('Users (snapshot)', String(report.totals.users));
  line('Products (snapshot)', String(report.totals.products));
  line('Sales', String(report.totals.sales));
  line('Revenue', formatGhs(report.totals.revenue));
  line('Cash revenue', formatGhs(report.totals.cashRevenue));
  line('Paystack revenue', formatGhs(report.totals.paystackRevenue));
  line('Expenses', formatGhs(report.totals.expenses));
  line('Expense entries', String(report.totals.expenseCount));
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text('By store', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');

  const activeStores = report.byStore.filter((s) => s.sales > 0 || s.expenseCount > 0);
  const rows = activeStores.length > 0 ? activeStores : report.byStore.slice(0, 20);

  if (rows.length === 0) {
    line('No stores found.');
  } else {
    rows.forEach((row) => {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(row.storeName.slice(0, 48), 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        `${row.sales} sales · Rev ${formatGhs(row.revenue)} · Cash ${formatGhs(row.cashRevenue)} · Paystack ${formatGhs(row.paystackRevenue)} · Exp ${formatGhs(row.expenses)}`,
        14,
        y
      );
      y += 7;
    });
  }

  doc.save(`adimat-system-report-${report.fromDate}-to-${report.toDate}.pdf`);
}

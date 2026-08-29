import { isSupabaseConfigured, supabase } from './supabase';
import { FormalPdf, formatGhsOfficial, formatOfficialDate } from './formalPdf';

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
  const period = `${formatOfficialDate(report.fromDate)} to ${formatOfficialDate(report.toDate)}`;
  const pdf = new FormalPdf(
    { name: 'Adimat', reference: 'Platform administration' },
    {
      title: 'Whole-system report',
      subtitle: 'Consolidated activity across all stores',
      period: `Reporting period: ${period}`,
      documentLabel: 'ADMINISTRATOR REPORT',
      generatedAt: new Date(report.generatedAt),
      notes: [
        'This report aggregates completed sales and recorded expenses from every store on the platform for the selected period.',
        'User and product counts are a snapshot at the time of generation. Figures are for administration and are not audited accounts.',
      ],
    }
  );

  pdf.section('Platform totals');
  pdf.kvTable([
    { label: 'Stores', value: String(report.totals.stores) },
    { label: 'Stores with activity', value: String(report.totals.storesWithActivity) },
    { label: 'Users (snapshot)', value: String(report.totals.users) },
    { label: 'Products (snapshot)', value: String(report.totals.products) },
    { label: 'Completed sales', value: String(report.totals.sales) },
    { label: 'Revenue', value: formatGhsOfficial(report.totals.revenue) },
    { label: 'Cash revenue', value: formatGhsOfficial(report.totals.cashRevenue) },
    { label: 'Paystack revenue', value: formatGhsOfficial(report.totals.paystackRevenue) },
    { label: 'Expenses', value: formatGhsOfficial(report.totals.expenses) },
    { label: 'Expense entries', value: String(report.totals.expenseCount), emphasis: 'muted' },
  ]);

  const activeStores = report.byStore.filter((s) => s.sales > 0 || s.expenseCount > 0);
  const rows = activeStores.length > 0 ? activeStores : report.byStore;

  pdf.section('Activity by store');
  if (rows.length === 0) {
    pdf.paragraph('No stores were found for this period.', true);
  } else {
    pdf.dataTable(
      ['Store', 'Sales', 'Revenue', 'Cash', 'Paystack', 'Expenses'],
      rows.map((row) => [
        row.storeName,
        String(row.sales),
        formatGhsOfficial(row.revenue),
        formatGhsOfficial(row.cashRevenue),
        formatGhsOfficial(row.paystackRevenue),
        formatGhsOfficial(row.expenses),
      ]),
      [3.2, 1, 1.6, 1.4, 1.6, 1.6]
    );
  }

  pdf.signatureBlock('Prepared by administrator', 'Reviewed by');
  pdf.save(`adimat-system-report-${report.fromDate}-to-${report.toDate}.pdf`);
}

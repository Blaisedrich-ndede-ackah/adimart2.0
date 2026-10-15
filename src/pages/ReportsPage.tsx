import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  TrendingUp, Banknote, CreditCard, Calendar, ChevronDown, Receipt,
  Download, FileText, PiggyBank, Package, Users, Tag, Plus, Trash2, Loader2,
  Warehouse, Store, MapPin, Camera
} from 'lucide-react';
import {
  db, LocalTransaction, LocalTransactionItem, LocalExpense, LocalCreditPayment, LocalCustomerOpeningPayment, LocalStockBatch, LocalLocation,
  getCurrentStoreTransactions, getCurrentStoreExpenses, getCurrentStoreId,
  addExpense, deleteExpense
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { roundMoney, toMoneyAmount } from '@/lib/money';
import {
  buildLocationReportSummary,
  buildReportSummary,
  exportLocationReportCsv,
  exportLocationReportPdf,
  exportReportCsv,
  exportReportPdf,
  formatReportPeriodLabel,
  listReportLocations,
  resolveReportRange,
  type ReportPeriod,
  ReportSummary,
} from '@/lib/reportAnalytics';
import { getExpiringBatches } from '@/lib/warehouse';
import FinancialDonutChart from '@/components/FinancialDonutChart';
import { parseOtherCharges } from '@/lib/otherCharges';
import { orgFromStore } from '@/lib/formalPdf';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { fileToProductImageDataUrl } from '@/lib/productImage';

type ReportTab = 'overview' | 'products' | 'expenses' | 'locations';

interface DayData {
  day: string;
  revenue: number;
  count: number;
}

const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Other'];

function todayDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStartDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function ReportsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [customFrom, setCustomFrom] = useState(monthStartDateOnly);
  const [customTo, setCustomTo] = useState(todayDateOnly);
  const [appliedFrom, setAppliedFrom] = useState(monthStartDateOnly);
  const [appliedTo, setAppliedTo] = useState(todayDateOnly);
  const [rangeError, setRangeError] = useState('');
  const [tab, setTab] = useState<ReportTab>('overview');
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [creditPayments, setCreditPayments] = useState<LocalCreditPayment[]>([]);
  const [customerOpeningPayments, setCustomerOpeningPayments] = useState<LocalCustomerOpeningPayment[]>([]);
  const [outstandingCredit, setOutstandingCredit] = useState(0);
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [chartData, setChartData] = useState<DayData[]>([]);
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [txnItems, setTxnItems] = useState<Record<string, LocalTransactionItem[]>>({});
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Other');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseReceipt, setExpenseReceipt] = useState('');
  const [expenseReceiptError, setExpenseReceiptError] = useState('');
  const [expenseSaveError, setExpenseSaveError] = useState('');
  const expenseReceiptInput = useRef<HTMLInputElement>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [expiringBatches, setExpiringBatches] = useState<LocalStockBatch[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [exportingLocationId, setExportingLocationId] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadData = useCallback(async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return;

    let range;
    try {
      range = resolveReportRange(period, appliedFrom, appliedTo);
      setRangeError('');
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : 'Invalid date range');
      return;
    }

    setLoadingReport(true);
    setLoadError('');
    try {
      const { start, end } = range;
      const allTxns = (await getCurrentStoreTransactions()).filter(t => t.status === 'completed');
      const allCreditPayments = await db.credit_payments.where('store_id').equals(storeId).toArray();
      const allCustomerOpeningPayments = await db.customer_opening_payments.where('store_id').equals(storeId).toArray();
      setCustomerOpeningPayments(allCustomerOpeningPayments.filter((payment) => {
        if (payment.entry_type !== 'payment') return false;
        const day = payment.created_at.slice(0, 10);
        return day >= start.toISOString().slice(0, 10) && day <= end.toISOString().slice(0, 10);
      }));
      const customers = await db.customers.where('store_id').equals(storeId).toArray();
      setOutstandingCredit(roundMoney(
        allTxns.reduce((sum, transaction) => sum + (Number(transaction.credit_balance) || 0), 0) +
        customers.reduce((sum, customer) => sum + (Number(customer.opening_balance_remaining) || 0), 0)
      ));
      const allExpenses = await getCurrentStoreExpenses();
      const expiring = await getExpiringBatches(storeId, 30);
      setExpiringBatches(expiring.slice(0, 8));
      const products = await db.products.where('store_id').equals(storeId).toArray();
      const names: Record<string, string> = {};
      products.forEach((p) => { names[p.id] = p.name; });
      setProductNames(names);
      setLocations(await listReportLocations(storeId));

      const periodTxns = allTxns.filter(t => {
        const d = new Date(t.created_at);
        return d >= start && d <= end;
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const periodExpenses = allExpenses.filter(e => {
        const d = new Date(e.created_at);
        return d >= start && d <= end;
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setTransactions(periodTxns);
      setCreditPayments(allCreditPayments.filter((payment) => {
        const paidAt = new Date(payment.created_at);
        return paidAt >= start && paidAt <= end;
      }));
      setExpenses(periodExpenses);
      setSummary(await buildReportSummary(storeId, range));

      // Chart: last up to 14 days inside the selected range
      const dayMs = 24 * 60 * 60 * 1000;
      const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1);
      const chartDays = Math.min(14, spanDays);
      const days: DayData[] = [];
      for (let i = chartDays - 1; i >= 0; i--) {
        const d = new Date(end);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        if (d < start) continue;
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        const dayTxns = allTxns.filter(t => {
          const td = new Date(t.created_at);
          return td >= dayStart && td <= dayEnd;
        });
        days.push({
          day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          revenue: dayTxns.reduce((s, t) => s + t.total_amount, 0),
          count: dayTxns.length,
        });
      }
      setChartData(days);
    } catch (error) {
      console.error('[Reports] Could not load report data:', error);
      setLoadError('Could not load report data from this device. Check storage and try again.');
    } finally {
      setLoadingReport(false);
    }
  }, [period, appliedFrom, appliedTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadTxnItems = async (txnId: string) => {
    if (txnItems[txnId]) {
      setExpandedTxn(expandedTxn === txnId ? null : txnId);
      return;
    }
    const items = await db.transaction_items.where('transaction_id').equals(txnId).toArray();
    setTxnItems(prev => ({ ...prev, [txnId]: items }));
    setExpandedTxn(txnId);
  };

  const periodLabel = formatReportPeriodLabel(period, appliedFrom, appliedTo);

  const applyCustomRange = () => {
    try {
      resolveReportRange('custom', customFrom, customTo);
      setRangeError('');
      setAppliedFrom(customFrom);
      setAppliedTo(customTo);
      setPeriod('custom');
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : 'Invalid date range');
    }
  };

  const handleExportCsv = () => {
    if (!summary || !currentStore) return;
    exportReportCsv(summary, periodLabel, currentStore.name, transactions, expenses);
  };

  const handleExportPdf = () => {
    if (!summary || !currentStore) return;
    exportReportPdf(summary, periodLabel, currentStore.name, orgFromStore(currentStore));
  };

  const handleExportLocation = async (locationId: string, format: 'csv' | 'pdf') => {
    const storeId = await getCurrentStoreId();
    if (!storeId || !currentStore) return;
    setExportingLocationId(locationId);
    try {
      const range = resolveReportRange(period, appliedFrom, appliedTo);
      const locSummary = await buildLocationReportSummary(
        storeId,
        locationId,
        range,
        currentStore.name,
        periodLabel,
        period
      );
      if (format === 'csv') exportLocationReportCsv(locSummary);
      else exportLocationReportPdf(locSummary, orgFromStore(currentStore));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export location report');
    }
    setExportingLocationId(null);
  };

  const handleAddExpense = async () => {
    const amount = toMoneyAmount(expenseAmount);
    setExpenseSaveError('');
    if (!expenseDesc.trim() || amount <= 0) {
      setExpenseSaveError('Enter an expense description and a valid amount.');
      return;
    }
    setSavingExpense(true);
    const recordedBy = currentUser?.name?.trim();
    const noteParts = [
      expenseNotes.trim(),
      recordedBy ? `Recorded by ${recordedBy}` : '',
    ].filter(Boolean);
    try {
      await addExpense({
        description: expenseDesc.trim(),
        category: expenseCategory,
        amount,
        notes: noteParts.join(' · '),
        receipt_image_data_url: expenseReceipt || undefined,
      });
      setExpenseDesc('');
      setExpenseAmount('');
      setExpenseNotes('');
      setExpenseReceipt('');
      setShowAddExpense(false);
      await loadData();
    } catch (error) {
      console.error('[Reports] Could not record expense:', error);
      setExpenseSaveError(error instanceof Error ? error.message : 'Could not save expense. Try again.');
    } finally {
      setSavingExpense(false);
    }
  };

  const handleExpenseReceiptPick = async (file?: File) => {
    setExpenseReceiptError('');
    if (!file) return;
    try {
      setExpenseReceipt(await fileToProductImageDataUrl(file));
    } catch (error) {
      console.error('[Reports] Could not process receipt photo:', error);
      setExpenseReceiptError(error instanceof Error ? error.message : 'Could not attach receipt photo.');
    } finally {
      if (expenseReceiptInput.current) expenseReceiptInput.current.value = '';
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Delete this expense?')) return;
    await deleteExpense(id);
    loadData();
  };

  const totalRevenue = summary?.revenue ?? 0;
  const accountPaymentRows = [...creditPayments, ...customerOpeningPayments];
  const cashRevenue = roundMoney(
    transactions.reduce((sum, transaction) =>
      sum + (transaction.payment_method === 'credit' ? 0 : Number(transaction.cash_amount) || 0), 0
    ) + accountPaymentRows.reduce(
      (sum, payment) => sum + Number(payment.cash_amount ?? (payment.payment_method === 'cash' || !payment.payment_method ? payment.amount : 0)),
      0
    )
  );
  const nonCashRevenue = roundMoney(transactions.reduce(
    (s, t) => s + (Number(t.paystack_amount) || 0) + (Number(t.manual_payment_amount) || 0),
    0
  ) + accountPaymentRows.reduce(
    (sum, payment) => sum + (Number(payment.momo_amount) || 0) + (Number(payment.cheque_amount) || 0),
    0
  ));
  const creditRevenue = roundMoney(transactions.reduce(
    (sum, transaction) => sum + (transaction.payment_method === 'credit' ? Number(transaction.total_amount) || 0 : 0),
    0
  ));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white font-bold text-lg">{t('reports.title')}</h1>
          <div className="flex gap-2">
            <button onClick={handleExportCsv} className="bg-white/20 p-2 rounded-lg" title="Export CSV">
              <Download className="w-4 h-4 text-white" />
            </button>
            <button onClick={handleExportPdf} className="bg-white/20 p-2 rounded-lg" title="Export PDF">
              <FileText className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        <div className="flex bg-white/15 rounded-xl p-0.5 mb-2">
          {([
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
            { key: 'custom', label: 'Custom' },
          ] as const).map(tabItem => (
            <button
              key={tabItem.key}
              onClick={() => {
                if (tabItem.key === 'custom') {
                  setPeriod('custom');
                  return;
                }
                setPeriod(tabItem.key);
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                period === tabItem.key ? 'bg-white text-primary' : 'text-white/80'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="bg-white/10 rounded-xl p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-emerald-100/80">From</span>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border-0 px-2 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-emerald-100/80">To</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={todayDateOnly()}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border-0 px-2 py-2 text-sm text-slate-900"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={applyCustomRange}
              disabled={loadingReport}
              className="w-full rounded-lg bg-white text-primary py-2 text-sm font-semibold disabled:opacity-60"
            >
              {loadingReport ? 'Generating…' : 'Generate report'}
            </button>
            {rangeError && (
              <p className="text-[11px] text-amber-100">{rangeError}</p>
            )}
            {period === 'custom' && !rangeError && (
              <p className="text-[11px] text-emerald-100/90">
                Showing whole-store results for {periodLabel}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {([
            { key: 'overview', label: 'Overview', icon: TrendingUp },
            { key: 'products', label: 'Products', icon: Package },
            { key: 'expenses', label: 'Expenses', icon: PiggyBank },
            { key: 'locations', label: 'Locations', icon: MapPin },
          ] as const).map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  tab === item.key ? 'bg-white text-primary' : 'bg-white/15 text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="page-body no-scrollbar">
        {loadingReport && !summary && (
          <div className="space-y-3" aria-label="Loading report" aria-busy="true">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />)}
            </div>
            <div className="h-56 animate-pulse rounded-xl bg-white shadow-sm" />
          </div>
        )}
        {loadError && (
          <div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadData()} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold">Retry report</button>
          </div>
        )}
        {!loadingReport && !loadError && !summary && (
          <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-600">
            No report data is available yet. Complete a sale or record an expense to see your store summary.
          </div>
        )}
        {tab === 'overview' && summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
              <div className="bg-white rounded-xl p-3 shadow-sm border border-emerald-50 col-span-2 md:col-span-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-xs text-gray-500 font-medium">Total Revenue</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{money(totalRevenue)}</p>
                <p className="text-xs text-gray-500">{transactions.length} transactions</p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-500">Gross Profit</p>
                <p className="text-lg font-bold text-green-600">{money(summary.grossProfit)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-500">Net Profit</p>
                <p className={`text-lg font-bold ${summary.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {money(summary.netProfit)}
                </p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <Banknote className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Cash</span>
                </div>
                <p className="text-lg font-bold">{money(cashRevenue)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4 text-blue-600" />
                  <span className="text-xs text-gray-500">Non-cash received</span>
                </div>
                <p className="text-lg font-bold">{money(nonCashRevenue)}</p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-amber-100">
                <p className="text-xs text-gray-500">Credit sales</p>
                <p className="text-lg font-bold text-amber-800">{money(creditRevenue)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border border-amber-100">
                <p className="text-xs text-gray-500">Outstanding credit</p>
                <p className="text-lg font-bold text-amber-800">{money(outstandingCredit)}</p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 col-span-2">
                <p className="text-xs text-gray-500">Expenses</p>
                <p className="text-lg font-bold text-red-500">{money(summary.expenses)}</p>
              </div>
            </div>

            <div className="mb-4 md:max-w-md md:mx-auto">
              <FinancialDonutChart
                title="Financial breakdown"
                metrics={{
                  costPrice: summary.costOfGoods,
                  sellingPrice: summary.revenue,
                  profitEstimate: summary.revenue - summary.costOfGoods,
                }}
              />
            </div>

            {expiringBatches.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Expiring within 30 days
                </h3>
                <div className="space-y-1.5">
                  {expiringBatches.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-xs">
                      <span className="text-amber-950 font-medium truncate mr-2">
                        {productNames[b.product_id] || 'Product'}
                        {b.batch_code ? ` · ${b.batch_code}` : ''}
                      </span>
                      <span className="text-amber-800 flex-shrink-0">
                        {b.quantity} pcs · {b.expiry_date}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Sales by Cashier
              </h3>
              {summary.cashiers.length === 0 ? (
                <p className="text-xs text-gray-400">No sales yet</p>
              ) : (
                <div className="space-y-2">
                  {summary.cashiers.map(c => (
                    <div key={c.cashier_id} className="flex justify-between text-sm">
                      <span>{c.cashier_name} ({c.transactions})</span>
                      <span className="font-semibold">{money(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Sales by Category
              </h3>
              {summary.categories.length === 0 ? (
                <p className="text-xs text-gray-400">No category data</p>
              ) : (
                <div className="space-y-2">
                  {summary.categories.map(c => (
                    <div key={c.category} className="flex justify-between text-sm">
                      <span>{c.category} ({c.quantity})</span>
                      <span className="font-semibold">{money(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                7-Day Revenue
              </h3>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => String(Math.round(v))} />
                    <Tooltip formatter={(value: unknown) => [`${money(Number(value))}`, 'Revenue']} />
                    <Bar dataKey="revenue" fill="#065f46" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Transaction Register
              </h3>
              {transactions.length === 0 ? (
                <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">No transactions</div>
              ) : (
                <div className="space-y-2">
                  {transactions.map(txn => (
                    <div key={txn.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <button onClick={() => loadTxnItems(txn.id)} className="w-full p-3 flex items-center justify-between">
                        <div className="text-left">
                          <p className="text-xs font-mono font-bold text-primary">{txn.receipt_number}</p>
                          <p className="text-[10px] text-gray-500">
                            {new Date(txn.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                            {' • '}{txn.cashier_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{money(txn.total_amount)}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${expandedTxn === txn.id ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedTxn === txn.id && txnItems[txn.id] && (
                        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                          {txnItems[txn.id].map(item => (
                            <div key={item.id} className="flex justify-between py-1 text-xs">
                              <span>{item.product_name} × {item.quantity}</span>
                              <span>{money(item.subtotal)}</span>
                            </div>
                          ))}
                          {parseOtherCharges(txn.other_charges_json).map((charge) => (
                            <div key={charge.id} className="flex justify-between py-1 text-xs text-gray-600">
                              <span>{charge.label}</span>
                              <span>{money(charge.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'products' && summary && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold text-gray-700 mb-3">Top Selling Products</h3>
              {summary.topProducts.length === 0 ? (
                <p className="text-xs text-gray-400">No product sales yet</p>
              ) : (
                summary.topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
                    <div>
                      <span className="text-primary font-bold mr-2">#{i + 1}</span>
                      {p.product_name}
                      <p className="text-xs text-gray-500">{p.quantity} sold</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{money(p.revenue)}</p>
                      <p className="text-xs text-green-600">Profit {money(p.profit)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold text-gray-700 mb-3">Slow Movers</h3>
              {summary.slowProducts.length === 0 ? (
                <p className="text-xs text-gray-400">No data</p>
              ) : (
                summary.slowProducts.map(p => (
                  <div key={p.product_id} className="flex justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
                    <span>{p.product_name}</span>
                    <span className="text-gray-500">{p.quantity} sold</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'expenses' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">Track business expenses to see net profit</p>
              <button
                onClick={() => setShowAddExpense(true)}
                className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {showAddExpense && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
                <input
                  value={expenseDesc}
                  onChange={e => setExpenseDesc(e.target.value)}
                  placeholder="Description (e.g. Shop rent)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={expenseAmount}
                    onChange={e => setExpenseAmount(e.target.value)}
                    placeholder="Amount"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                  <select
                    value={expenseCategory}
                    onChange={e => setExpenseCategory(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <input
                  value={expenseNotes}
                  onChange={e => setExpenseNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600">
                  <Camera className="h-4 w-4" />
                  {expenseReceipt ? 'Receipt photo attached' : 'Attach receipt photo (optional)'}
                  <input ref={expenseReceiptInput} type="file" accept="image/*" capture="environment" onChange={(event) => void handleExpenseReceiptPick(event.target.files?.[0])} className="sr-only" />
                </label>
                {expenseReceipt && <div className="flex items-center gap-2"><img src={expenseReceipt} alt="Expense receipt preview" className="h-14 w-14 rounded object-cover" /><button type="button" onClick={() => setExpenseReceipt('')} className="text-xs text-red-700">Remove photo</button></div>}
                {expenseReceiptError && <p role="alert" className="text-xs text-red-700">{expenseReceiptError}</p>}
                {expenseSaveError && <p role="alert" className="text-xs text-red-700">{expenseSaveError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setShowAddExpense(false)} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
                  <button
                    onClick={handleAddExpense}
                    disabled={savingExpense}
                    className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  >
                    {savingExpense && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            )}

            {expenses.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">No expenses recorded</div>
            ) : (
              expenses.map(expense => (
                <div key={expense.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{expense.description}</p>
                    <p className="text-xs text-gray-500">
                      {expense.category} • {new Date(expense.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-500">{money(expense.amount)}</span>
                    <button onClick={() => handleDeleteExpense(expense.id)} className="p-1.5 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'locations' && (
          <div className="space-y-3 md:max-w-3xl md:mx-auto xl:max-w-none xl:mx-0">
            <p className="text-xs text-gray-500 leading-relaxed">
              Export an individual report for each shop or warehouse. Uses the selected period (
              {periodLabel}) for sales, plus on-hand stock valuation.
            </p>
            {locations.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
                No locations yet. Enable Warehouse and add shops/warehouses first.
              </div>
            ) : (
              locations.map((loc) => {
                const busy = exportingLocationId === loc.id;
                return (
                  <div
                    key={loc.id}
                    className="bg-white border border-emerald-50 rounded-xl px-4 py-3.5 flex items-center gap-3"
                  >
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        loc.location_type === 'warehouse'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-primary'
                      }`}
                    >
                      {loc.location_type === 'warehouse' ? (
                        <Warehouse className="w-5 h-5" />
                      ) : (
                        <Store className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{loc.name}</p>
                      <p className="text-[11px] text-gray-500 capitalize mt-0.5">
                        {loc.location_type}
                        {loc.is_default === 1 ? ' · Default' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleExportLocation(loc.id, 'csv')}
                        className="px-2.5 py-2 rounded-lg bg-emerald-50 text-primary text-xs font-semibold touch-target disabled:opacity-50"
                        title="Export CSV"
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleExportLocation(loc.id, 'pdf')}
                        className="px-2.5 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold touch-target disabled:opacity-50"
                        title="Export PDF"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

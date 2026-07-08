import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  TrendingUp, Banknote, CreditCard, Calendar, ChevronDown, Receipt,
  Download, FileText, PiggyBank, Package, Users, Tag, Plus, Trash2, Loader2
} from 'lucide-react';
import {
  db, LocalTransaction, LocalTransactionItem, LocalExpense,
  getCurrentStoreTransactions, getCurrentStoreExpenses, getCurrentStoreId,
  addExpense, deleteExpense
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import {
  buildReportSummary, exportReportCsv, exportReportPdf, getPeriodRange, ReportSummary
} from '@/lib/reportAnalytics';

type Period = 'today' | 'week' | 'month';
type ReportTab = 'overview' | 'products' | 'expenses';

interface DayData {
  day: string;
  revenue: number;
  count: number;
}

const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Other'];

export default function ReportsPage() {
  const { currentStore } = useAuthStore();
  const [period, setPeriod] = useState<Period>('today');
  const [tab, setTab] = useState<ReportTab>('overview');
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
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
  const [savingExpense, setSavingExpense] = useState(false);

  const loadData = useCallback(async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return;

    const { start, end } = getPeriodRange(period);
    const allTxns = (await getCurrentStoreTransactions()).filter(t => t.status === 'completed');
    const allExpenses = await getCurrentStoreExpenses();

    const periodTxns = allTxns.filter(t => {
      const d = new Date(t.created_at);
      return d >= start && d <= end;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const periodExpenses = allExpenses.filter(e => {
      const d = new Date(e.created_at);
      return d >= start && d <= end;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setTransactions(periodTxns);
    setExpenses(periodExpenses);
    setSummary(await buildReportSummary(storeId, period));

    const now = new Date();
    const days: DayData[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
      const dayTxns = allTxns.filter(t => {
        const td = new Date(t.created_at);
        return td >= dayStart && td <= dayEnd;
      });
      days.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        revenue: dayTxns.reduce((s, t) => s + t.total_amount, 0),
        count: dayTxns.length,
      });
    }
    setChartData(days);
  }, [period]);

  useEffect(() => {
    loadData();
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

  const periodLabel = period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month';

  const handleExportCsv = () => {
    if (!summary || !currentStore) return;
    exportReportCsv(summary, periodLabel, currentStore.name, transactions, expenses);
  };

  const handleExportPdf = () => {
    if (!summary || !currentStore) return;
    exportReportPdf(summary, periodLabel, currentStore.name);
  };

  const handleAddExpense = async () => {
    const amount = parseFloat(expenseAmount);
    if (!expenseDesc.trim() || isNaN(amount) || amount <= 0) return;
    setSavingExpense(true);
    await addExpense({
      description: expenseDesc.trim(),
      category: expenseCategory,
      amount,
      notes: expenseNotes.trim(),
    });
    setExpenseDesc('');
    setExpenseAmount('');
    setExpenseNotes('');
    setShowAddExpense(false);
    setSavingExpense(false);
    loadData();
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Delete this expense?')) return;
    await deleteExpense(id);
    loadData();
  };

  const totalRevenue = summary?.revenue ?? 0;
  const cashRevenue = transactions.filter(t => t.payment_method === 'cash').reduce((s, t) => s + t.total_amount, 0);
  const paystackRevenue = transactions
    .filter(t => t.payment_method === 'paystack' || t.payment_method === 'split')
    .reduce((s, t) => s + (t.paystack_amount || 0), 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-primary px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white font-bold text-lg">Reports & Analytics</h1>
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
            { key: 'week', label: 'This Week' },
            { key: 'month', label: 'This Month' },
          ] as const).map(tabItem => (
            <button
              key={tabItem.key}
              onClick={() => setPeriod(tabItem.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                period === tabItem.key ? 'bg-white text-primary' : 'text-white/80'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {([
            { key: 'overview', label: 'Overview', icon: TrendingUp },
            { key: 'products', label: 'Products', icon: Package },
            { key: 'expenses', label: 'Expenses', icon: PiggyBank },
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

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-20 no-scrollbar">
        {tab === 'overview' && summary && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 col-span-2">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-xs text-gray-500 font-medium">Total Revenue</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">GH₵{totalRevenue.toFixed(2)}</p>
                <p className="text-xs text-gray-500">{transactions.length} transactions</p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-500">Gross Profit</p>
                <p className="text-lg font-bold text-green-600">GH₵{summary.grossProfit.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-500">Net Profit</p>
                <p className={`text-lg font-bold ${summary.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  GH₵{summary.netProfit.toFixed(2)}
                </p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <Banknote className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Cash</span>
                </div>
                <p className="text-lg font-bold">GH₵{cashRevenue.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4 text-blue-600" />
                  <span className="text-xs text-gray-500">Paystack</span>
                </div>
                <p className="text-lg font-bold">GH₵{paystackRevenue.toFixed(2)}</p>
              </div>

              <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 col-span-2">
                <p className="text-xs text-gray-500">Expenses</p>
                <p className="text-lg font-bold text-red-500">GH₵{summary.expenses.toFixed(2)}</p>
              </div>
            </div>

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
                      <span className="font-semibold">GH₵{c.revenue.toFixed(2)}</span>
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
                      <span className="font-semibold">GH₵{c.revenue.toFixed(2)}</span>
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
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `₵${v}`} />
                    <Tooltip formatter={(value: unknown) => [`GH₵${Number(value).toFixed(2)}`, 'Revenue']} />
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
                          <span className="text-sm font-bold">GH₵{txn.total_amount.toFixed(2)}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${expandedTxn === txn.id ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedTxn === txn.id && txnItems[txn.id] && (
                        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                          {txnItems[txn.id].map(item => (
                            <div key={item.id} className="flex justify-between py-1 text-xs">
                              <span>{item.product_name} × {item.quantity}</span>
                              <span>GH₵{item.subtotal.toFixed(2)}</span>
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
                      <p className="font-semibold">GH₵{p.revenue.toFixed(2)}</p>
                      <p className="text-xs text-green-600">Profit GH₵{p.profit.toFixed(2)}</p>
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
                    <span className="text-sm font-bold text-red-500">GH₵{expense.amount.toFixed(2)}</span>
                    <button onClick={() => handleDeleteExpense(expense.id)} className="p-1.5 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

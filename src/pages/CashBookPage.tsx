import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen, ChevronLeft, ChevronRight, Calendar, Plus, Minus, Trash2, Loader2, X,
  FileSpreadsheet, Landmark, Download,
} from 'lucide-react';
import {
  LocalCashBookEntry,
  addCashBookEntry,
  deleteCashBookEntry,
  getCurrentStoreCashBookEntries,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerAutoSync } from '@/lib/sync';
import { roundMoney, toMoneyAmount } from '@/lib/money';
import {
  buildStoreFinancialStatements,
  exportFinancialStatementsPdf,
  type StoreFinancialStatements,
} from '@/lib/financialStatements';

const INCOME_CATEGORIES = ['Cash sales', 'Capital', 'Loan', 'Refund', 'Other'];
const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Withdrawal', 'Other'];

type CashBookPeriod = 'today' | 'week' | 'month' | 'custom';

const PERIOD_TABS: { key: CashBookPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'custom', label: 'Custom' },
];

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday 00:00 of the week containing `date` */
function getWeekStart(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthEnd(monthStart: Date): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
}

function formatRangeLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (toDateOnly(start) === toDateOnly(end)) {
    return start.toLocaleDateString('en-GB', opts);
  }
  return `${start.toLocaleDateString('en-GB', opts)} - ${end.toLocaleDateString('en-GB', opts)}`;
}

function formatMoney(amount: number): string {
  return `GH₵${amount.toFixed(2)}`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Store cash book (Cash Flow):
 * manual income/expense ledger with Today / Week / Month / Custom filters.
 */
export default function CashBookPage() {
  const { currentUser } = useAuthStore();
  const [period, setPeriod] = useState<CashBookPeriod>('today');
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [monthStart, setMonthStart] = useState(() => getMonthStart());
  const [customFrom, setCustomFrom] = useState(() => toDateOnly(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateOnly(new Date()));
  const [entries, setEntries] = useState<LocalCashBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<'income' | 'expense' | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Other');
  const [notes, setNotes] = useState('');
  const [entryDate, setEntryDate] = useState(() => toDateOnly(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'ledger' | 'statements'>('ledger');
  const [statements, setStatements] = useState<StoreFinancialStatements | null>(null);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [statementsError, setStatementsError] = useState('');

  const today = toDateOnly(new Date());
  const currentWeekStart = toDateOnly(getWeekStart());
  const currentMonthStart = toDateOnly(getMonthStart());

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (period === 'today') {
      const d = parseDateOnly(today);
      return { rangeStart: d, rangeEnd: d };
    }
    if (period === 'week') {
      return { rangeStart: weekStart, rangeEnd: addDays(weekStart, 6) };
    }
    if (period === 'month') {
      return { rangeStart: monthStart, rangeEnd: monthEnd(monthStart) };
    }
    const from = customFrom <= customTo ? customFrom : customTo;
    const to = customFrom <= customTo ? customTo : customFrom;
    return { rangeStart: parseDateOnly(from), rangeEnd: parseDateOnly(to) };
  }, [period, today, weekStart, monthStart, customFrom, customTo]);

  const fromDate = toDateOnly(rangeStart);
  const toDate = toDateOnly(rangeEnd);
  const canGoNextWeek = toDateOnly(weekStart) < currentWeekStart;
  const canGoNextMonth = toDateOnly(monthStart) < currentMonthStart;

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getCurrentStoreCashBookEntries();
    const inRange = all
      .filter((e) => e.entry_date >= fromDate && e.entry_date <= toDate)
      .sort((a, b) => {
        const byDate = b.entry_date.localeCompare(a.entry_date);
        if (byDate !== 0) return byDate;
        return b.created_at.localeCompare(a.created_at);
      });
    setEntries(inRange);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = formatRangeLabel(rangeStart, rangeEnd);

  const loadStatements = useCallback(async () => {
    setStatementsLoading(true);
    setStatementsError('');
    try {
      const data = await buildStoreFinancialStatements(fromDate, toDate, periodLabel);
      setStatements(data);
    } catch (err) {
      setStatements(null);
      setStatementsError(err instanceof Error ? err.message : 'Could not build statements');
    }
    setStatementsLoading(false);
  }, [fromDate, toDate, periodLabel]);

  useEffect(() => {
    if (view !== 'statements') return;
    void loadStatements();
  }, [view, loadStatements]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of entries) {
      if (e.entry_type === 'income') income += Number(e.amount) || 0;
      else expense += Number(e.amount) || 0;
    }
    return {
      income: roundMoney(income),
      expense: roundMoney(expense),
      net: roundMoney(income - expense),
    };
  }, [entries]);

  const emptyLabel =
    period === 'today'
      ? 'today'
      : period === 'week'
        ? 'this week'
        : period === 'month'
          ? 'this month'
          : 'this date range';

  const openComposer = (type: 'income' | 'expense') => {
    setComposer(type);
    setDescription('');
    setAmount('');
    setNotes('');
    setError('');
    setEntryDate(today > toDate ? toDate : today < fromDate ? fromDate : today);
    setCategory(type === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  };

  const handleSave = async () => {
    setError('');
    const value = toMoneyAmount(amount);
    if (!description.trim()) {
      setError('Enter a description.');
      return;
    }
    if (value <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!composer) return;

    setSaving(true);
    try {
      await addCashBookEntry({
        entry_type: composer,
        description: description.trim(),
        category,
        amount: value,
        notes: notes.trim(),
        entry_date: entryDate || today,
        created_by: currentUser?.name || '',
      });
      setComposer(null);
      await load();
      void triggerAutoSync('cash-book');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this cash book entry?')) return;
    await deleteCashBookEntry(id);
    await load();
    void triggerAutoSync('cash-book');
  };

  const categories = composer === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-5 h-5 text-white shrink-0" />
          <div>
            <h1 className="text-white font-bold text-lg">Cash Flow</h1>
            <p className="text-emerald-200 text-xs">Store cash book</p>
          </div>
        </div>

        <div className="flex bg-white/15 rounded-xl p-0.5 mb-2">
          <button
            type="button"
            onClick={() => setView('ledger')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              view === 'ledger' ? 'bg-white text-primary' : 'text-white/80'
            }`}
          >
            Ledger
          </button>
          <button
            type="button"
            onClick={() => setView('statements')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              view === 'statements' ? 'bg-white text-primary' : 'text-white/80'
            }`}
          >
            Statements
          </button>
        </div>

        <div className="flex bg-white/15 rounded-xl p-0.5">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setPeriod(tab.key);
                if (tab.key === 'week') setWeekStart(getWeekStart());
                if (tab.key === 'month') setMonthStart(getMonthStart());
                if (tab.key === 'today') {
                  /* range is derived from today */
                }
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                period === tab.key ? 'bg-white text-primary' : 'text-white/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="bg-white/10 rounded-xl p-3 mt-2 space-y-2">
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
                  max={today}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border-0 px-2 py-2 text-sm text-slate-900"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="page-body no-scrollbar space-y-3">
        {(period === 'week' || period === 'month') && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-2 py-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                period === 'week'
                  ? setWeekStart((w) => addDays(w, -7))
                  : setMonthStart((m) => addMonths(m, -1))
              }
              className="p-2.5 rounded-lg touch-target text-slate-600 hover:bg-slate-50"
              aria-label={period === 'week' ? 'Previous week' : 'Previous month'}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-slate-800 truncate">
                {formatRangeLabel(rangeStart, rangeEnd)}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                period === 'week'
                  ? setWeekStart((w) => addDays(w, 7))
                  : setMonthStart((m) => addMonths(m, 1))
              }
              disabled={period === 'week' ? !canGoNextWeek : !canGoNextMonth}
              className="p-2.5 rounded-lg touch-target text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label={period === 'week' ? 'Next week' : 'Next month'}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {(period === 'today' || period === 'custom') && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2.5 flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm font-semibold text-slate-800 truncate">
              {formatRangeLabel(rangeStart, rangeEnd)}
            </p>
          </div>
        )}

        {view === 'statements' && (
          <StatementsPanel
            loading={statementsLoading}
            error={statementsError}
            data={statements}
            onRefresh={() => void loadStatements()}
          />
        )}

        {view === 'ledger' && (
        <>
        {/* Net + income/expense summary */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-5 text-center border-b border-slate-100">
            <p className="text-sm text-slate-500">Net Cash Flow</p>
            <p
              className={`text-3xl font-bold mt-1 ${
                totals.net >= 0 ? 'text-slate-900' : 'text-red-600'
              }`}
            >
              {formatMoney(totals.net)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">(Total Income − Total Expense)</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            <div className="px-4 py-4 text-center">
              <p className="text-sm text-slate-500">Income</p>
              <p className="text-xl font-bold text-emerald-600 mt-1">{formatMoney(totals.income)}</p>
            </div>
            <div className="px-4 py-4 text-center">
              <p className="text-sm text-slate-500">Expense</p>
              <p className="text-xl font-bold text-red-500 mt-1">{formatMoney(totals.expense)}</p>
            </div>
          </div>
        </div>

        {/* Entries */}
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 px-6 py-16 text-center">
            <p className="text-sm text-slate-400 leading-relaxed">
              No Expense/Income Entries for
              <br />
              {emptyLabel}
            </p>
            <p className="text-sm text-slate-400 mt-2">Click on + Button to add</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const isIncome = entry.entry_type === 'income';
              return (
                <div
                  key={entry.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-white shrink-0 ${
                          isIncome ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      >
                        {isIncome ? (
                          <Plus className="w-3.5 h-3.5" />
                        ) : (
                          <Minus className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {entry.description}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 pl-8">
                      {entry.category} · {entry.entry_date}
                      {entry.created_by ? ` · ${entry.created_by}` : ''}
                    </p>
                    {entry.notes ? (
                      <p className="text-[11px] text-slate-400 mt-0.5 pl-8 truncate">
                        {entry.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`text-sm font-bold ${
                        isIncome ? 'text-emerald-600' : 'text-red-500'
                      }`}
                    >
                      {isIncome ? '+' : '−'}
                      {formatMoney(entry.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 touch-target"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      {/* Bottom income / expense actions */}
      {view === 'ledger' && (
      <div className="shrink-0 grid grid-cols-2 border-t border-slate-200">
        <button
          type="button"
          onClick={() => openComposer('income')}
          className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-4 text-base font-bold touch-target"
        >
          <Plus className="w-5 h-5" />
          Income
        </button>
        <button
          type="button"
          onClick={() => openComposer('expense')}
          className="flex items-center justify-center gap-2 bg-red-500 text-white py-4 text-base font-bold touch-target"
        >
          <Minus className="w-5 h-5" />
          Expense
        </button>
      </div>
      )}

      {/* Add entry sheet */}
      {composer && (
        <div className="sheet-backdrop animate-fade-in z-50">
          <div className="sheet-panel animate-slide-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                Add {composer === 'income' ? 'Income' : 'Expense'}
              </h2>
              <button
                type="button"
                onClick={() => setComposer(null)}
                className="p-2 rounded-full hover:bg-gray-100 touch-target"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="date"
                value={entryDate}
                min={fromDate}
                max={toDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setComposer(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 ${
                    composer === 'income' ? 'bg-emerald-600' : 'bg-red-500'
                  }`}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementsPanel({
  loading,
  error,
  data,
  onRefresh,
}: {
  loading: boolean;
  error: string;
  data: StoreFinancialStatements | null;
  onRefresh: () => void;
}) {
  if (loading && !data) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-5 text-sm text-red-700">
        {error}
        <button type="button" onClick={onRefresh} className="block mt-2 font-semibold underline">
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 touch-target"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Refresh
        </button>
        <button
          type="button"
          onClick={() => exportFinancialStatementsPdf(data)}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white touch-target"
        >
          <Download className="w-4 h-4" />
          Download PDF
        </button>
      </div>

      <StatementCard
        icon={<FileSpreadsheet className="w-4 h-4" />}
        title="Income statement"
        subtitle={`${data.incomeStatement.fromDate} to ${data.incomeStatement.toDate}`}
        lines={data.incomeStatement.lines}
      />
      <StatementCard
        icon={<Landmark className="w-4 h-4" />}
        title="Statement of financial position"
        subtitle={`As of ${data.financialPosition.asOfDate}`}
        lines={data.financialPosition.lines}
      />
      <p className="text-[11px] text-slate-500 leading-relaxed px-1">
        Built from POS sales, expenses, cash-book entries, and current inventory at cost.
        Capital and loans stay on the balance sheet. Cash-book “Cash sales” is not added again
        on top of POS sales.
      </p>
    </div>
  );
}

function StatementCard({
  icon,
  title,
  subtitle,
  lines,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  lines: { label: string; amount: number; emphasis?: 'total' | 'subtotal' | 'muted' }[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
        <span className="text-primary mt-0.5">{icon}</span>
        <div>
          <p className="text-sm font-bold text-slate-900">{title}</p>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {lines.map((line) => {
          const strong = line.emphasis === 'total' || line.emphasis === 'subtotal';
          return (
            <div
              key={line.label}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                line.emphasis === 'total' ? 'bg-emerald-50/70' : ''
              }`}
            >
              <p
                className={`text-sm ${
                  strong ? 'font-bold text-slate-900' : line.emphasis === 'muted' ? 'text-slate-500' : 'text-slate-700'
                }`}
              >
                {line.label}
              </p>
              <p
                className={`text-sm tabular-nums ${
                  strong
                    ? 'font-bold text-slate-900'
                    : line.amount < 0
                      ? 'text-red-600'
                      : 'text-slate-800'
                }`}
              >
                {formatMoney(line.amount)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

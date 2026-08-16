import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ChevronLeft, ChevronRight, Calendar, Plus, Minus, Trash2, Loader2, X,
} from 'lucide-react';
import {
  LocalCashBookEntry,
  addCashBookEntry,
  deleteCashBookEntry,
  getCurrentStoreCashBookEntries,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerAutoSync } from '@/lib/sync';

const INCOME_CATEGORIES = ['Cash sales', 'Capital', 'Loan', 'Refund', 'Other'];
const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Withdrawal', 'Other'];

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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatRangeLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${start.toLocaleDateString('en-GB', opts)} - ${end.toLocaleDateString('en-GB', opts)}`;
}

function formatMoney(amount: number): string {
  return `GH₵${amount.toFixed(2)}`;
}

/**
 * Owner-only cash book (Cash Flow):
 * manual income/expense ledger with weekly net cash flow.
 */
export default function CashBookPage() {
  const { currentUser } = useAuthStore();
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
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

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const fromDate = toDateOnly(weekStart);
  const toDate = toDateOnly(weekEnd);
  const today = toDateOnly(new Date());
  const canGoNext = fromDate < toDateOnly(getWeekStart());

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

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of entries) {
      if (e.entry_type === 'income') income += e.amount;
      else expense += e.amount;
    }
    return {
      income,
      expense,
      net: income - expense,
    };
  }, [entries]);

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
    const value = parseFloat(amount);
    if (!description.trim()) {
      setError('Enter a description.');
      return;
    }
    if (isNaN(value) || value <= 0) {
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
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-white shrink-0" />
          <div>
            <h1 className="text-white font-bold text-lg">Cash Flow</h1>
            <p className="text-emerald-200 text-xs">Owner cash book</p>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar space-y-3">
        {/* Week navigator */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-2 py-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="p-2.5 rounded-lg touch-target text-slate-600 hover:bg-slate-50"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm font-semibold text-slate-800 truncate">
              {formatRangeLabel(weekStart, weekEnd)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            disabled={!canGoNext}
            className="p-2.5 rounded-lg touch-target text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Next week"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

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
              this week
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
      </div>

      {/* Bottom income / expense actions */}
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

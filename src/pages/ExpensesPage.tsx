import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiggyBank, Plus, Trash2, Loader2, RefreshCcw, Camera, Repeat, AlertTriangle } from 'lucide-react';
import {
  addRecurringExpense,
  db,
  LocalExpenseBudget,
  LocalExpense,
  LocalRecurringExpense,
  addExpense,
  createDueRecurringExpenses,
  getCurrentStoreExpenseBudgets,
  getCurrentStoreExpenses,
  getCurrentStoreRecurringExpenses,
  deleteExpense,
  saveExpenseBudget,
  setRecurringExpenseActive,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { toMoneyAmount } from '@/lib/money';
import { useFormatMoney } from '@/lib/currency';
import { cashbookCategoryLabel, useT } from '@/lib/i18n';
import { fileToProductImageDataUrl } from '@/lib/productImage';

const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Other'];
function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Store expenses — available to owners and cashiers so floor staff can
 * record day-to-day costs without opening full Reports.
 */
export default function ExpensesPage({
  openAddOnLoad = false,
  onQuickActionHandled,
}: {
  openAddOnLoad?: boolean;
  onQuickActionHandled?: () => void;
}) {
  const { currentUser } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const isOwner = currentUser?.role === 'owner';

  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Other');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [recurringDay, setRecurringDay] = useState('1');
  const [recurringExpenses, setRecurringExpenses] = useState<LocalRecurringExpense[]>([]);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurringDescription, setRecurringDescription] = useState('');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [recurringCategory, setRecurringCategory] = useState('Rent');
  const [recurringNotes, setRecurringNotes] = useState('');
  const [recurringError, setRecurringError] = useState('');
  const [budgets, setBudgets] = useState<LocalExpenseBudget[]>([]);
  const [budgetCategory, setBudgetCategory] = useState('Rent');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      await createDueRecurringExpenses();
      const [all, templates, storeBudgets] = await Promise.all([
        getCurrentStoreExpenses(),
        getCurrentStoreRecurringExpenses(),
        getCurrentStoreExpenseBudgets(),
      ]);
      setExpenses(all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setRecurringExpenses(templates.sort((a, b) => a.description.localeCompare(b.description)));
      setBudgets(storeBudgets.sort((a, b) => a.category.localeCompare(b.category)));
    } catch (loadError) {
      console.error('[Expenses] Could not load expenses:', loadError);
      setLoadError('Could not load expenses. Check available storage and refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openAddOnLoad) return;
    setShowAdd(true);
    onQuickActionHandled?.();
  }, [openAddOnLoad, onQuickActionHandled]);

  const budgetUsage = useMemo(() => {
    const month = currentMonth();
    const monthlyExpenses = expenses.filter((expense) => (expense.recurrence_month || expense.created_at.slice(0, 7)) === month);
    return budgets.map((budget) => ({
      ...budget,
      spent: monthlyExpenses.filter((expense) => expense.category === budget.category)
        .reduce((total, expense) => total + Number(expense.amount || 0), 0),
    }));
  }, [budgets, expenses]);

  const handleReceiptPick = async (file?: File) => {
    setReceiptError('');
    if (!file) return;
    try {
      setReceiptImage(await fileToProductImageDataUrl(file));
    } catch (pickError) {
      console.error('[Expenses] Could not process receipt photo:', pickError);
      setReceiptError(pickError instanceof Error ? pickError.message : 'Could not attach receipt photo.');
    } finally {
      if (receiptInputRef.current) receiptInputRef.current.value = '';
    }
  };

  const handleAdd = async () => {
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

    setSaving(true);
    try {
      const recordedBy = currentUser?.name?.trim();
      const noteParts = [
        notes.trim(),
        recordedBy ? `Recorded by ${recordedBy}` : '',
      ].filter(Boolean);

      await addExpense({
        description: description.trim(),
        category,
        amount: value,
        notes: noteParts.join(' · '),
        receipt_image_data_url: receiptImage || undefined,
      });
      setDescription('');
      setAmount('');
      setNotes('');
      setCategory('Other');
      setReceiptImage('');
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!isOwner) return;
    if (!confirm('Delete this expense?')) return;
    await deleteExpense(id);
    await load();
  };

  const total = toMoneyAmount(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));

  const handleSaveBudget = async () => {
    setBudgetError('');
    setSavingBudget(true);
    try {
      await saveExpenseBudget(budgetCategory, toMoneyAmount(budgetAmount));
      setBudgetAmount('');
      await load();
    } catch (saveError) {
      setBudgetError(saveError instanceof Error ? saveError.message : 'Could not save monthly budget.');
    } finally {
      setSavingBudget(false);
    }
  };

  const handleAddRecurring = async () => {
    setRecurringError('');
    try {
      await addRecurringExpense({
        description: recurringDescription,
        category: recurringCategory,
        amount: toMoneyAmount(recurringAmount),
        notes: recurringNotes,
        day_of_month: Number(recurringDay),
        is_active: 1,
      });
      setRecurringDescription('');
      setRecurringAmount('');
      setRecurringNotes('');
      setShowRecurringForm(false);
      await load();
    } catch (saveError) {
      setRecurringError(saveError instanceof Error ? saveError.message : 'Could not save recurring expense.');
    }
  };

  const toggleRecurring = async (template: LocalRecurringExpense) => {
    try {
      await setRecurringExpenseActive(template.id, template.is_active !== 1);
      await load();
    } catch (toggleError) {
      setLoadError(toggleError instanceof Error ? toggleError.message : 'Could not update recurring expense.');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <PiggyBank className="w-5 h-5 text-white shrink-0" />
            <div className="min-w-0">
              <h1 className="text-white font-bold text-lg">{t('expenses.title')}</h1>
              <p className="text-emerald-200 text-xs truncate">
                {isOwner
                  ? 'Record and manage store expenses'
                  : 'Add store expenses from the floor'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void load()}
              className="bg-white/20 p-2 rounded-xl touch-target"
              title="Refresh"
            >
              <RefreshCcw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => {
                setError('');
                setShowAdd(true);
              }}
              className="flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-white touch-target"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar space-y-4">
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load()} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold">Refresh</button>
          </div>
        )}

        {isOwner && (
          <>
            <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">Monthly budgets · {currentMonth()}</h2>
              {budgetUsage.length === 0 ? <p className="mt-2 text-xs text-gray-500">Set a category budget to track spending and get over-budget warnings.</p> : (
                <div className="mt-3 space-y-2">
                  {budgetUsage.map((budget) => {
                    const over = budget.spent > budget.monthly_limit;
                    const percentage = Math.min(100, Math.round((budget.spent / budget.monthly_limit) * 100));
                    return (
                      <div key={budget.id} className={`rounded-lg p-3 ${over ? 'bg-red-50' : 'bg-slate-50'}`}>
                        <div className="flex justify-between gap-2 text-xs">
                          <strong>{budget.category}</strong>
                          <span className={over ? 'font-bold text-red-700' : 'text-gray-600'}>{money(budget.spent)} / {money(budget.monthly_limit)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${over ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${percentage}%` }} /></div>
                        {over && <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-700"><AlertTriangle className="h-3 w-3" />Over budget by {money(budget.spent - budget.monthly_limit)}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <select aria-label="Budget category" value={budgetCategory} onChange={(event) => setBudgetCategory(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  {EXPENSE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
                </select>
                <input aria-label="Monthly budget amount" type="number" min="0.01" step="0.01" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} placeholder="Monthly limit" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </div>
              {budgetError && <p role="alert" className="mt-2 text-xs text-red-700">{budgetError}</p>}
              <button type="button" disabled={savingBudget} onClick={() => void handleSaveBudget()} className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingBudget ? 'Saving…' : 'Save category budget'}</button>
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><Repeat className="h-4 w-4 text-primary" /> Monthly recurring expenses</h2>
                <button type="button" onClick={() => setShowRecurringForm((shown) => !shown)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold touch-target">Add recurring</button>
              </div>
              {showRecurringForm && (
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                  <input aria-label="Recurring expense description" value={recurringDescription} onChange={(event) => setRecurringDescription(event.target.value)} placeholder="e.g. Shop rent" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <select aria-label="Recurring expense category" value={recurringCategory} onChange={(event) => setRecurringCategory(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">{EXPENSE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
                    <input aria-label="Recurring expense amount" type="number" min="0.01" step="0.01" value={recurringAmount} onChange={(event) => setRecurringAmount(event.target.value)} placeholder="Amount" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-600">Create on/after day <input aria-label="Recurring day of month" type="number" min="1" max="31" value={recurringDay} onChange={(event) => setRecurringDay(event.target.value)} className="w-16 rounded border border-gray-200 px-2 py-1" /> each month</label>
                  <input aria-label="Recurring expense notes" value={recurringNotes} onChange={(event) => setRecurringNotes(event.target.value)} placeholder="Notes (optional)" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  {recurringError && <p role="alert" className="text-xs text-red-700">{recurringError}</p>}
                  <button type="button" onClick={() => void handleAddRecurring()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">Save monthly expense</button>
                </div>
              )}
              {recurringExpenses.length === 0 ? <p className="mt-2 text-xs text-gray-500">Rent, salaries, and other recurring costs can be added here.</p> : (
                <div className="mt-2 divide-y divide-gray-100">
                  {recurringExpenses.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <div><p className="text-xs font-semibold">{item.description} · {money(item.amount)}</p><p className="text-[11px] text-gray-500">{item.category} · creates on/after day {item.day_of_month} monthly</p></div>
                      <button type="button" onClick={() => void toggleRecurring(item)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${item.is_active === 1 ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>{item.is_active === 1 ? 'Active' : 'Paused'}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">All recorded expenses</p>
            <p className="text-lg font-bold text-red-500">{money(total)}</p>
          </div>
          <p className="text-xs text-gray-400">{expenses.length} item{expenses.length === 1 ? '' : 's'}</p>
        </div>

        {showAdd && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
            <p className="text-sm font-semibold text-gray-900">New expense</p>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (e.g. Shop rent)"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600">
              <Camera className="h-4 w-4" />
              {receiptImage ? 'Receipt photo attached' : 'Attach receipt photo (optional)'}
              <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => void handleReceiptPick(event.target.files?.[0])} className="sr-only" />
            </label>
            {receiptImage && <div className="flex items-center gap-2"><img src={receiptImage} alt="Expense receipt preview" className="h-16 w-16 rounded object-cover" /><button type="button" onClick={() => setReceiptImage('')} className="text-xs text-red-700">Remove photo</button></div>}
            {receiptError && <p role="alert" className="text-xs text-red-700">{receiptError}</p>}
            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setError('');
                }}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={saving}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
            No expenses recorded yet. Tap Add to record your first store cost.
          </div>
        ) : (
          <div className="space-y-2">
            {expenses.map((expense) => (
              <div
                key={expense.id}
                className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {expense.description}
                  </p>
                  <p className="text-xs text-gray-500">
                    {expense.category} ·{' '}
                    {new Date(expense.created_at).toLocaleString()}
                  </p>
                  {expense.notes ? (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {expense.notes}
                    </p>
                  ) : null}
                  {expense.receipt_image_data_url && <a href={expense.receipt_image_data_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-primary">View receipt photo</a>}
                  {expense.recurring_expense_id && <p className="mt-1 text-[10px] text-emerald-700">Monthly recurring entry</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm font-bold text-red-500">
                    {money(expense.amount)}
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(expense.id)}
                      className="p-1.5 hover:bg-red-50 rounded-lg touch-target"
                      title="Delete expense"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isOwner && (
          <p className="text-[11px] text-gray-500 text-center px-2 pb-4">
            Cashiers can add expenses. Ask the store owner if you need one removed.
          </p>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { PiggyBank, Plus, Trash2, Loader2, RefreshCcw } from 'lucide-react';
import {
  LocalExpense,
  getCurrentStoreExpenses,
  addExpense,
  deleteExpense,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';

const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Supplier', 'Salaries', 'Transport', 'Other'];

/**
 * Store expenses — available to owners and cashiers so floor staff can
 * record day-to-day costs without opening full Reports.
 */
export default function ExpensesPage() {
  const { currentUser } = useAuthStore();
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

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getCurrentStoreExpenses();
    setExpenses(
      all.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
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
      });
      setDescription('');
      setAmount('');
      setNotes('');
      setCategory('Other');
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

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <PiggyBank className="w-5 h-5 text-white shrink-0" />
            <div className="min-w-0">
              <h1 className="text-white font-bold text-lg">Expenses</h1>
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
              className="flex items-center gap-1 bg-white text-primary px-3 py-2 rounded-xl text-xs font-semibold touch-target"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar space-y-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">All recorded expenses</p>
            <p className="text-lg font-bold text-red-500">GH₵{total.toFixed(2)}</p>
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
            No expenses recorded yet. Tap Add to log one.
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
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm font-bold text-red-500">
                    GH₵{expense.amount.toFixed(2)}
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

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createProductCategory,
  deleteProductCategory,
  getCurrentStoreProductCategories,
  LocalProductCategory,
  renameProductCategory,
} from '@/lib/dexie';
import { triggerPushSync } from '@/lib/sync';

export default function ManageProductCategoriesModal({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [categories, setCategories] = useState<LocalProductCategory[]>([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCategories(await getCurrentStoreProductCategories());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load product categories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setEditingId(null);
    void load();
  }, [isOpen]);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      if (editingId) await renameProductCategory(editingId, name);
      else await createProductCategory(name);
      setName('');
      setEditingId(null);
      await load();
      onChanged();
      void triggerPushSync('product-categories');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save category.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category: LocalProductCategory) => {
    if (!window.confirm(`Delete "${category.name}"? Products in this category will be moved to Other.`)) return;
    setError('');
    try {
      await deleteProductCategory(category.id);
      await load();
      onChanged();
      void triggerPushSync('product-categories');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete category.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Product categories</h2>
            <p className="text-xs text-gray-500 mt-0.5">Add, rename, or remove inventory categories.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              maxLength={100}
              placeholder="Category name"
              className="flex-1 min-w-0 px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>

          {editingId && (
            <button
              type="button"
              onClick={() => { setEditingId(null); setName(''); setError(''); }}
              className="text-xs font-medium text-gray-500 underline"
            >
              Cancel rename
            </button>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {loading ? (
            <div className="flex justify-center py-8 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {categories.map((category) => (
                <div key={category.id} className="flex items-center gap-2 py-2.5">
                  <span className="flex-1 text-sm text-gray-800">{category.name}</span>
                  <button
                    type="button"
                    onClick={() => { setEditingId(category.id); setName(category.name); setError(''); }}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                    aria-label={`Rename ${category.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(category)}
                    disabled={category.name.toLocaleLowerCase() === 'other'}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30"
                    aria-label={`Delete ${category.name}`}
                    title={category.name.toLocaleLowerCase() === 'other' ? 'The Other category is required' : 'Delete category'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X, Plus, Minus, Package, Save } from 'lucide-react';
import { db, LocalProduct } from '@/lib/dexie';

interface StockAdjustmentProps {
  isOpen: boolean;
  product: LocalProduct | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function StockAdjustment({ isOpen, product, onClose, onSaved }: StockAdjustmentProps) {
  const [adjustmentType, setAdjustmentType] = useState<'set' | 'add' | 'subtract'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !product) return null;

  const calculateNewStock = (): number => {
    const value = parseInt(amount) || 0;
    switch (adjustmentType) {
      case 'set':
        return Math.max(0, value);
      case 'add':
        return product.stock_level + value;
      case 'subtract':
        return Math.max(0, product.stock_level - value);
    }
  };

  const handleSave = async () => {
    if (!amount || parseInt(amount) < 0) {
      setError('Enter a valid quantity');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const newStock = calculateNewStock();
      await db.products.update(product.id, {
        stock_level: newStock,
        updated_at: new Date().toISOString(),
        synced: 0,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update stock');
    }

    setSaving(false);
  };

  const newStock = calculateNewStock();

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
      <div className="bg-white rounded-t-3xl w-full max-w-lg animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Adjust Stock</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 touch-target">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Product Info */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border border-gray-200">
                <Package className="w-6 h-6 text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{product.name}</p>
                <p className="text-sm text-gray-500">Current stock: <strong>{product.stock_level}</strong></p>
              </div>
            </div>
          </div>

          {/* Adjustment Type */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Adjustment Type</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setAdjustmentType('add')}
                className={`py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 touch-target ${
                  adjustmentType === 'add'
                    ? 'bg-green-100 text-green-700 border-2 border-green-500'
                    : 'bg-gray-100 text-gray-700 border-2 border-transparent'
                }`}
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
              <button
                onClick={() => setAdjustmentType('subtract')}
                className={`py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 touch-target ${
                  adjustmentType === 'subtract'
                    ? 'bg-red-100 text-red-700 border-2 border-red-500'
                    : 'bg-gray-100 text-gray-700 border-2 border-transparent'
                }`}
              >
                <Minus className="w-4 h-4" />
                Remove
              </button>
              <button
                onClick={() => setAdjustmentType('set')}
                className={`py-3 rounded-xl text-sm font-medium touch-target ${
                  adjustmentType === 'set'
                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-500'
                    : 'bg-gray-100 text-gray-700 border-2 border-transparent'
                }`}
              >
                Set To
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              {adjustmentType === 'set' ? 'New Stock Level' : 'Quantity'}
            </label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center focus:ring-2 focus:ring-primary outline-none"
              autoFocus
            />
          </div>

          {/* Preview */}
          {amount && (
            <div className={`p-4 rounded-xl ${
              newStock === 0 ? 'bg-red-50' : newStock < 5 ? 'bg-amber-50' : 'bg-green-50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">New Stock Level</span>
                <span className={`text-xl font-bold ${
                  newStock === 0 ? 'text-red-600' : newStock < 5 ? 'text-amber-600' : 'text-green-600'
                }`}>
                  {newStock}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {product.stock_level} → {newStock}
                {newStock === 0 && ' (Out of Stock)'}
                {newStock > 0 && newStock < 5 && ' (Low Stock)'}
              </p>
            </div>
          )}

          {/* Reason (optional) */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g., New shipment, damaged items, etc."
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !amount}
              className="flex-1 py-3 bg-primary text-white rounded-xl font-medium touch-target flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Update Stock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

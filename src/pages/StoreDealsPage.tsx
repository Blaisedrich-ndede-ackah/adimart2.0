import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { db, generateId, type LocalProduct, type LocalStorePromotion, type StorePromoType } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerPushSync } from '@/lib/sync';

const TYPES: Array<{ id: StorePromoType; label: string }> = [
  { id: 'sale_price', label: 'Timed sale price' },
  { id: 'percent', label: 'Percentage off' },
  { id: 'fixed', label: 'Fixed amount off' },
  { id: 'multibuy', label: 'Buy some, get some free' },
  { id: 'coupon', label: 'Coupon code' },
];

const empty = {
  name: '',
  promoType: 'percent' as StorePromoType,
  productId: '',
  category: '',
  salePrice: '',
  percentOff: '',
  amountOff: '',
  buyQuantity: '2',
  freeQuantity: '1',
  couponCode: '',
  startsAt: '',
  endsAt: '',
};

export default function StoreDealsPage() {
  const store = useAuthStore((state) => state.currentStore);
  const [deals, setDeals] = useState<LocalStorePromotion[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!store?.id) return;
    const [rows, catalog] = await Promise.all([
      db.store_promotions.where('store_id').equals(store.id).reverse().sortBy('updated_at'),
      db.products.where('store_id').equals(store.id).and((product) => product.is_active === 1).sortBy('name'),
    ]);
    setDeals(rows);
    setProducts(catalog);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!store?.id) return;
    setError('');
    const name = form.name.trim();
    if (!name) {
      setError('Name the deal.');
      return;
    }
    const now = new Date().toISOString();
    await db.store_promotions.add({
      id: generateId(),
      store_id: store.id,
      name,
      promo_type: form.promoType,
      product_id: form.productId || null,
      category: form.category.trim(),
      sale_price: Number(form.salePrice) || 0,
      percent_off: Number(form.percentOff) || 0,
      amount_off: Number(form.amountOff) || 0,
      buy_quantity: Math.max(0, Math.floor(Number(form.buyQuantity) || 0)),
      free_quantity: Math.max(0, Math.floor(Number(form.freeQuantity) || 0)),
      coupon_code: form.couponCode.trim(),
      starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 0,
    });
    setForm(empty);
    await load();
    void triggerPushSync('store-deals');
  };

  const toggle = async (deal: LocalStorePromotion) => {
    await db.store_promotions.update(deal.id, {
      is_active: deal.is_active === 1 ? 0 : 1,
      updated_at: new Date().toISOString(),
      synced: 0,
    });
    await load();
    void triggerPushSync('store-deals');
  };

  const remove = async (deal: LocalStorePromotion) => {
    await db.store_promotions.delete(deal.id);
    await load();
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="text-white font-bold text-lg">Deals & coupons</h1>
        <p className="text-emerald-100 text-xs mt-1">
          Sale prices, multi-buy offers, and coupons apply at the POS. ADIMAT flyers stay under Promotions.
        </p>
      </div>
      <div className="p-4 space-y-4">
        <form
          className="ios-glass rounded-2xl p-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h2 className="font-bold">New deal</h2>
          </div>
          <input aria-label="Deal name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Deal name" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          <select aria-label="Deal type" value={form.promoType} onChange={(event) => setForm({ ...form, promoType: event.target.value as StorePromoType })} className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm">
            {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
          <select aria-label="Product" value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm">
            <option value="">All products, or pick one</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <input aria-label="Category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Or a category name" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          {(form.promoType === 'sale_price') && (
            <input aria-label="Sale price" type="number" min="0" step="0.01" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} placeholder="Sale price" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          )}
          {(form.promoType === 'percent' || form.promoType === 'coupon') && (
            <input aria-label="Percent off" type="number" min="0" max="100" step="0.01" value={form.percentOff} onChange={(event) => setForm({ ...form, percentOff: event.target.value })} placeholder="Percent off" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          )}
          {(form.promoType === 'fixed' || form.promoType === 'coupon') && (
            <input aria-label="Amount off" type="number" min="0" step="0.01" value={form.amountOff} onChange={(event) => setForm({ ...form, amountOff: event.target.value })} placeholder="Amount off" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          )}
          {form.promoType === 'multibuy' && (
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Buy quantity" type="number" min="1" step="1" value={form.buyQuantity} onChange={(event) => setForm({ ...form, buyQuantity: event.target.value })} placeholder="Buy" className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
              <input aria-label="Free quantity" type="number" min="1" step="1" value={form.freeQuantity} onChange={(event) => setForm({ ...form, freeQuantity: event.target.value })} placeholder="Free" className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
            </div>
          )}
          <input aria-label="Coupon code" value={form.couponCode} onChange={(event) => setForm({ ...form, couponCode: event.target.value })} placeholder="Coupon code (leave empty to apply automatically)" className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Starts" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
            <input aria-label="Ends" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Save deal
          </button>
        </form>

        <div className="space-y-2">
          {deals.length === 0 && <p className="text-sm text-gray-500">No store deals yet. Checkout prices stay as they are.</p>}
          {deals.map((deal) => (
            <article key={deal.id} className="ios-glass rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{deal.name}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {deal.promo_type.replace('_', ' ')}
                    {deal.coupon_code ? ` · code ${deal.coupon_code}` : ' · automatic'}
                    {deal.category ? ` · ${deal.category}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void toggle(deal)} className="rounded-lg bg-white/80 px-2 py-1 text-xs font-semibold">
                    {deal.is_active === 1 ? 'Pause' : 'Resume'}
                  </button>
                  <button type="button" onClick={() => void remove(deal)} aria-label={`Delete ${deal.name}`} className="rounded-lg bg-white/80 p-1 text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

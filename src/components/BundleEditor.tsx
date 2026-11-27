import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { db, type LocalProduct } from '@/lib/dexie';
import { createBundle } from '@/lib/bundle';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';

export default function BundleEditor({ storeId, onSaved }: { storeId: string; onSaved: () => void }) {
  const t = useT();
  const money = useFormatMoney();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; quantity: number }>>([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void db.products.where('store_id').equals(storeId).and((row) => row.is_active === 1).toArray().then(setProducts); }, [storeId]);
  const individualTotal = useMemo(() => lines.reduce((total, line) => {
    const product = products.find((row) => row.id === line.productId);
    return total + (product?.selling_price || 0) * line.quantity;
  }, 0), [lines, products]);
  const savings = Math.max(0, individualTotal - (Number(price) || 0));
  const save = async () => {
    setBusy(true); setError(''); setSuccess('');
    try {
      await createBundle(storeId, name, Number(price), lines);
      setSuccess(t('bundle.saved')); setName(''); setPrice(''); setLines([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }]); onSaved();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : t('bundle.saveFailed')); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border bg-white p-4 shadow-sm">
    <h2 className="text-lg font-bold">{t('bundle.create')}</h2>
    <label className="mt-3 block text-sm font-semibold">{t('bundle.name')}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
    <div className="mt-3 space-y-2">
      {lines.map((line, index) => <div key={index} className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-semibold">{t('bundle.product')}<select value={line.productId} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, productId: event.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg border px-2 text-sm"><option value="">{t('bundle.chooseProduct')}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.selling_price)}</option>)}</select></label>
        <label className="w-20 text-xs font-semibold">{t('common.quantity')}<input type="number" min="1" step="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} className="mt-1 min-h-11 w-full rounded-lg border px-2" /></label>
        <button type="button" onClick={() => setLines((current) => current.length <= 2 ? current : current.filter((_, i) => i !== index))} aria-label={t('common.remove')} className="mb-0.5 min-h-11 rounded-lg border p-2"><Trash2 className="h-4 w-4" /></button>
      </div>)}
      <button type="button" onClick={() => setLines((current) => [...current, { productId: '', quantity: 1 }])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"><Plus className="h-4 w-4" />{t('bundle.addProduct')}</button>
    </div>
    <label className="mt-3 block text-sm font-semibold">{t('bundle.comboPrice')}<input type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
    <div className="mt-3 flex flex-wrap items-center justify-between rounded-xl bg-emerald-50 p-3 text-sm"><span>{t('bundle.individualTotal')}: {money(individualTotal)}</span><strong className="text-emerald-800">{t('bundle.savings')}: {money(savings)}</strong></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{success && <p role="status" className="mt-3 text-sm text-emerald-800">{success}</p>}
    <button type="button" onClick={() => void save()} disabled={busy || !name.trim() || !price || lines.some((line) => !line.productId)} className="mt-4 min-h-12 w-full rounded-xl bg-primary px-4 font-bold text-white disabled:opacity-50">{busy ? t('common.loading') : t('bundle.save')}</button>
  </section>;
}

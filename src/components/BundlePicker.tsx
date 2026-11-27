import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { listBundles, getBundleWithComponents, validateBundleStock, syncBundles, type BundleWithProducts } from '@/lib/bundle';
import { useCartStore } from '@/store/useCartStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import ProductImage from '@/components/ProductImage';

export default function BundlePicker({ storeId, locationId }: { storeId: string; locationId: string | null }) {
  const t = useT();
  const money = useFormatMoney();
  const addBundle = useCartStore((state) => state.addBundle);
  const [bundles, setBundles] = useState<BundleWithProducts[]>([]);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const rows = await listBundles(storeId);
    const full = await Promise.all(rows.map((row) => getBundleWithComponents(row.id)));
    setBundles(full.filter((row): row is BundleWithProducts => Boolean(row && row.components.length >= 2)));
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      await syncBundles(storeId).catch(() => 0);
      if (active) await refresh();
    };
    void load();
    const onOnline = () => { void load(); };
    window.addEventListener('online', onOnline);
    return () => { active = false; window.removeEventListener('online', onOnline); };
  }, [storeId]);
  const add = async (bundle: BundleWithProducts) => {
    const result = await validateBundleStock(storeId, bundle.bundle.id, 1, locationId);
    if (!result.ok) { setMessage(t('bundle.missingStock', { product: result.missing || '' })); return; }
    const added = await addBundle(bundle.bundle.id, locationId);
    setMessage(added.success ? t('bundle.added') : added.error || t('bundle.addFailed'));
  };
  return <div className="space-y-3 p-3">
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm">{message}</p>}
    {bundles.length === 0 ? <p className="rounded-xl bg-white p-6 text-center text-gray-500">{t('bundle.empty')}</p> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{bundles.map(({ bundle, components }) => <article key={bundle.id} className="rounded-2xl border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{bundle.name}</h3><p className="mt-1 text-lg font-extrabold text-primary">{money(bundle.combo_price)}</p></div><button type="button" onClick={() => void add({ bundle, components })} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white"><ShoppingCart className="h-4 w-4" />{t('bundle.addToCart')}</button></div>
      <ul className="mt-3 space-y-2">{components.map((component) => <li key={component.id} className="flex items-center gap-2 text-sm"><ProductImage src={component.product.image_url} alt="" size="sm" className="h-9 w-9 rounded object-cover" /><span className="min-w-0 flex-1 truncate">{component.product.name}</span><span className="text-gray-600">× {component.quantity}</span></li>)}</ul>
    </article>)}</div>}
  </div>;
}

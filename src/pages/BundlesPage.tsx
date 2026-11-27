import { useCallback, useEffect, useState } from 'react';
import BundleEditor from '@/components/BundleEditor';
import { listBundles, syncBundles, type ProductBundle } from '@/lib/bundle';
import { db } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';

export default function BundlesPage() {
  const { currentStore } = useAuthStore();
  const t = useT();
  const money = useFormatMoney();
  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  const refresh = useCallback(async () => {
    if (!currentStore?.id) return;
    setBundles(await listBundles(currentStore.id, false));
  }, [currentStore?.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!currentStore?.id) return;
    const sync = () => { void syncBundles(currentStore.id).then(refresh).catch(() => undefined); };
    sync(); window.addEventListener('online', sync); return () => window.removeEventListener('online', sync);
  }, [currentStore?.id, refresh]);
  if (!currentStore || currentStore.bundles_enabled === 0) return <main className="p-6 text-center text-gray-600">{t('bundle.disabled')}</main>;
  return <div className="page-shell"><header className="page-header"><h1 className="text-xl font-bold text-white">{t('bundle.title')}</h1></header><main className="page-body no-scrollbar space-y-4">
    <BundleEditor storeId={currentStore.id} onSaved={() => void refresh()} />
    <section className="rounded-2xl border bg-white p-4 shadow-sm"><h2 className="text-lg font-bold">{t('bundle.manage')}</h2>
      {bundles.length === 0 ? <p className="mt-3 text-sm text-gray-500">{t('bundle.empty')}</p> : <ul className="mt-3 divide-y">{bundles.map((bundle) => <li key={bundle.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-semibold">{bundle.name}</p><p className="text-sm text-gray-600">{money(bundle.combo_price)}</p></div><button type="button" onClick={async () => { await db.product_bundles.update(bundle.id, { is_active: bundle.is_active ? 0 : 1, synced: 0 }); await syncBundles(currentStore.id); await refresh(); }} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{bundle.is_active ? t('common.disable') : t('common.enable')}</button></li>)}</ul>}
    </section>
  </main></div>;
}

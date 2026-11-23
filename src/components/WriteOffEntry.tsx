import { useEffect, useMemo, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { db, type LocalProduct } from '@/lib/dexie';
import { recordWriteOff, type WriteOffReason } from '@/lib/writeOff';
import { useAuthStore } from '@/store/useAuthStore';
import { useT } from '@/lib/i18n';
import { useFormatMoney } from '@/lib/currency';

async function compressPhoto(file: File): Promise<string> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare photo.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL('image/jpeg', 0.72);
}

export default function WriteOffEntry({ onSaved }: { onSaved: () => void }) {
  const { currentStore, currentUser } = useAuthStore();
  const t = useT();
  const money = useFormatMoney();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState<LocalProduct | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState<WriteOffReason>('expired');
  const [photo, setPhoto] = useState('');
  const [note, setNote] = useState('');
  const [scanner, setScanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentStore?.id) void db.products.where('store_id').equals(currentStore.id).and((row) => row.is_active === 1).toArray().then(setProducts);
  }, [currentStore?.id]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term || product) return [];
    return products.filter((row) => row.name.toLocaleLowerCase().includes(term) || row.barcode.toLocaleLowerCase().includes(term)).slice(0, 8);
  }, [product, products, query]);

  const selectBarcode = (barcode: string) => {
    const found = products.find((row) => row.barcode === barcode.trim());
    if (found) { setProduct(found); setQuery(found.name); setScanner(false); setError(''); }
    else setError(t('writeoff.productNotFound'));
  };

  const save = async () => {
    if (!currentStore || !currentUser || !product) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const qty = Math.floor(Number(quantity));
      if (qty < 1 || qty > product.stock_level) throw new Error(t('writeoff.stockLimit'));
      const value = qty * product.cost_price;
      await recordWriteOff(currentStore.id, product.id, qty, reason, photo, note, currentUser.id, currentUser.name);
      setMessage(t('writeoff.saved', { quantity: qty, product: product.name, value: money(value) }));
      setProduct(null); setQuery(''); setQuantity('1'); setReason('expired'); setPhoto(''); setNote('');
      onSaved();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('writeoff.saveFailed'));
    } finally { setBusy(false); }
  };

  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
    <h2 className="text-lg font-bold text-gray-900">{t('writeoff.record')}</h2>
    <div className="mt-3 relative">
      <label className="text-sm font-semibold text-gray-700">{t('common.product')}
        <input value={query} onChange={(event) => { setQuery(event.target.value); setProduct(null); }} className="mt-1 min-h-12 w-full rounded-xl border px-3 py-2" placeholder={t('writeoff.searchProduct')} />
      </label>
      {matches.length > 0 && <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border bg-white shadow-lg">{matches.map((row) => <li key={row.id}><button type="button" onClick={() => { setProduct(row); setQuery(row.name); }} className="w-full px-3 py-2 text-left hover:bg-emerald-50">{row.name} · {money(row.selling_price)} · {t('writeoff.stock')}: {row.stock_level}</button></li>)}</ul>}
    </div>
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={() => setScanner((open) => !open)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 font-semibold"><ScanBarcode className="h-4 w-4" />{t('writeoff.scan')}</button>
      {product && <button type="button" onClick={() => { setProduct(null); setQuery(''); }} className="min-h-11 rounded-lg border px-3">{t('common.clear')}</button>}
    </div>
    {scanner && <div className="mt-3"><BarcodeScanner onScan={selectBarcode} active large /></div>}
    {product && <p className="mt-2 text-sm text-gray-600">{t('writeoff.availableStock', { quantity: product.stock_level })}</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-gray-700">{t('common.quantity')}
        <input type="number" min="1" max={product?.stock_level || undefined} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border px-3 py-2" />
      </label>
      <label className="text-sm font-semibold text-gray-700">{t('writeoff.reason')}
        <select value={reason} onChange={(event) => setReason(event.target.value as WriteOffReason)} className="mt-1 min-h-12 w-full rounded-xl border px-3 py-2">
          <option value="expired">{t('writeoff.expired')}</option><option value="damaged">{t('writeoff.damaged')}</option><option value="other">{t('writeoff.other')}</option>
        </select>
      </label>
    </div>
    <label className="mt-3 block text-sm font-semibold text-gray-700">{t('writeoff.photo')}
      <span className="mt-1 flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 font-normal"><Camera className="h-4 w-4" /><input type="file" accept="image/*" capture="environment" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void compressPhoto(file).then(setPhoto).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('writeoff.photoFailed')));
      }} className="min-w-0 flex-1 text-sm" /></span>
    </label>
    {photo && <img src={photo} alt={t('writeoff.photo')} className="mt-2 h-24 w-24 rounded-lg object-cover" />}
    <label className="mt-3 block text-sm font-semibold text-gray-700">{t('writeoff.note')}
      <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border px-3 py-2" />
    </label>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p>}
    <button type="button" onClick={() => void save()} disabled={busy || !product} className="mt-4 min-h-12 w-full rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? t('common.loading') : t('writeoff.submit')}</button>
  </section>;
}

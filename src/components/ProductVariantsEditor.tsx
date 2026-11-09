import { useCallback, useEffect, useState } from 'react';
import type { LocalProduct, LocalProductVariant } from '@/lib/dexie';
import { useFormatMoney } from '@/lib/currency';
import { canViewStockQuantities } from '@/lib/stockVisibility';
import { useAuthStore } from '@/store/useAuthStore';
import { formatQty } from '@/lib/measure';
import { listProductVariants, saveProductVariant, setVariantActive, variantSellingPrice } from '@/lib/variants';
import { triggerPushSync } from '@/lib/sync';

export default function ProductVariantsEditor({ product }: { product: LocalProduct }) {
  const money = useFormatMoney();
  const user = useAuthStore((state) => state.currentUser);
  const store = useAuthStore((state) => state.currentStore);
  const showStock = canViewStockQuantities(user, store);
  const [rows, setRows] = useState<LocalProductVariant[]>([]);
  const [name, setName] = useState('Size');
  const [value, setValue] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [price, setPrice] = useState(String(product.selling_price));
  const [stock, setStock] = useState('0');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRows(await listProductVariants(product.id));
  }, [product.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError('');
    try {
      await saveProductVariant({
        storeId: product.store_id,
        productId: product.id,
        variantName: name,
        variantValue: value,
        sku,
        barcode,
        price: Number(price),
        stockLevel: Number(stock),
      });
      setValue('');
      setSku('');
      setBarcode('');
      await load();
      void triggerPushSync('variant');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the variant.');
    }
  };

  return (
    <div className="ios-glass rounded-2xl p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Options</p>
        <p className="text-xs text-gray-600">Size, colour, flavour, or any other option. Each one has its own barcode, price, and stock.</p>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{row.variant_name}: {row.variant_value}</p>
            <p className="text-xs text-gray-500">
              {money(variantSellingPrice(product, row))}
              {row.sku ? ` · ${row.sku}` : ''}
              {row.barcode ? ` · ${row.barcode}` : ''}
              {showStock ? ` · stock ${formatQty(row.stock_level, product.unit)}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => void setVariantActive(row.id, row.is_active !== 1).then(load)} className="text-xs font-semibold text-primary">
            {row.is_active === 1 ? 'Hide' : 'Show'}
          </button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="Option name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Size" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        <input aria-label="Option value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Large" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        <input aria-label="Variant SKU" value={sku} onChange={(event) => setSku(event.target.value)} placeholder="SKU" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        <input aria-label="Variant barcode" value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Barcode" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        <input aria-label="Variant price" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Price" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        {showStock && (
          <input aria-label="Variant stock" type="number" min="0" step={product.allow_decimal === 1 ? '0.001' : '1'} value={stock} onChange={(event) => setStock(event.target.value)} placeholder="Stock" className="rounded-lg border border-white/80 bg-white/80 px-2 py-2 text-sm" />
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">
        Add option
      </button>
      {rows.length === 0 && <p className="text-[11px] text-gray-500">Products without options keep selling exactly as they do today.</p>}
    </div>
  );
}

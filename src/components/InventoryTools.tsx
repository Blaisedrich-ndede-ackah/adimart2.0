import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, PackagePlus, Printer, Search } from 'lucide-react';
import {
  db,
  type LocalLocation,
  type LocalProduct,
  type LocalStockMovement,
} from '@/lib/dexie';
import { downloadBarcodeLabels, printBarcodeLabel } from '@/lib/barcodeLabels';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerPushSync } from '@/lib/sync';
import { isPendingStockReceipt } from '@/lib/stockApprovals';
import {
  listLocations,
  receiveStock,
  recordStockCount,
  toQty,
} from '@/lib/warehouse';

type ToolTab = 'history' | 'receive' | 'count' | 'labels';

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'receive', label: 'Receive' },
  { id: 'count', label: 'Count' },
  { id: 'labels', label: 'Labels' },
];

function movementLabel(type: LocalStockMovement['movement_type'], note: string): string {
  if (note.toLowerCase().includes('stock count')) return 'Stock count';
  if (type === 'receive') return 'Received';
  if (type === 'transfer') return 'Transfer';
  if (type === 'sale') return 'Sale';
  if (type === 'return') return 'Return';
  return 'Adjustment';
}

export default function InventoryTools({
  products,
  onStockChanged,
}: {
  products: LocalProduct[];
  onStockChanged: () => void;
}) {
  const { currentStore, currentUser } = useAuthStore();
  const [tab, setTab] = useState<ToolTab>('history');
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const [movements, setMovements] = useState<LocalStockMovement[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [receiveProductId, setReceiveProductId] = useState('');
  const [receiveQty, setReceiveQty] = useState('1');
  const [receiveCost, setReceiveCost] = useState('');
  const [receiveBatch, setReceiveBatch] = useState('');
  const [receiveExpiry, setReceiveExpiry] = useState('');
  const [receiveNote, setReceiveNote] = useState('');

  const [countQuery, setCountQuery] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [countNote, setCountNote] = useState('');

  const [labelQuery, setLabelQuery] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<Record<string, boolean>>({});
  const [labelCopies, setLabelCopies] = useState('1');

  const activeProducts = useMemo(
    () => products.filter((product) => product.is_active === 1).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products]
  );

  const loadHistory = useCallback(async () => {
    if (!currentStore?.id) return;
    const rows = await db.stock_movements.where('store_id').equals(currentStore.id).toArray();
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    setMovements(rows.slice(0, 300));
  }, [currentStore?.id]);

  const refreshLocationStock = useCallback(async () => {
    if (!currentStore?.id || !locationId) return;
    const batches = await db.stock_batches
      .where('store_id')
      .equals(currentStore.id)
      .and((batch) => batch.location_id === locationId)
      .toArray();
    const next: Record<string, number> = {};
    for (const batch of batches) {
      next[batch.product_id] = (next[batch.product_id] || 0) + toQty(batch.quantity);
    }
    setLocationStock(next);
  }, [currentStore?.id, locationId]);

  useEffect(() => {
    void refreshLocationStock().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load location stock.');
    });
  }, [refreshLocationStock, products]);

  useEffect(() => {
    if (!currentStore?.id) return;
    void listLocations(currentStore.id).then((rows) => {
      setLocations(rows);
      setLocationId((current) => {
        if (current && rows.some((location) => location.id === current)) return current;
        return rows.find((location) => location.is_default === 1)?.id || rows[0]?.id || '';
      });
    }).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load locations.');
    });
    void loadHistory().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory history.');
    });
  }, [currentStore?.id, loadHistory]);

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return movements;
    return movements.filter((movement) => {
      const name = (productNames.get(movement.product_id) || '').toLowerCase();
      return (
        name.includes(query) ||
        movement.movement_type.includes(query) ||
        (movement.note || '').toLowerCase().includes(query) ||
        movementLabel(movement.movement_type, movement.note || '').toLowerCase().includes(query)
      );
    });
  }, [historyQuery, movements, productNames]);

  const countProducts = useMemo(() => {
    const query = countQuery.trim().toLowerCase();
    return activeProducts.filter((product) =>
      !query ||
      product.name.toLowerCase().includes(query) ||
      (product.barcode || '').toLowerCase().includes(query) ||
      (product.category || '').toLowerCase().includes(query)
    );
  }, [activeProducts, countQuery]);

  const labelProducts = useMemo(() => {
    const query = labelQuery.trim().toLowerCase();
    return activeProducts.filter((product) =>
      !query ||
      product.name.toLowerCase().includes(query) ||
      (product.barcode || '').toLowerCase().includes(query)
    );
  }, [activeProducts, labelQuery]);

  const flash = (text: string, failed = false) => {
    setError(failed ? text : '');
    setMessage(failed ? '' : text);
  };

  const submitReceive = async () => {
    if (!currentStore?.id || !locationId) {
      flash('Choose a location before receiving stock.', true);
      return;
    }
    setBusy(true);
    try {
      const product = activeProducts.find((item) => item.id === receiveProductId);
      if (!product) throw new Error('Choose a product to receive.');
      const cost = receiveCost.trim() ? Number(receiveCost) : undefined;
      if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) {
        throw new Error('Enter a valid cost price.');
      }
      const received = await receiveStock({
        storeId: currentStore.id,
        productId: product.id,
        locationId,
        quantity: Number(receiveQty),
        batchCode: receiveBatch,
        expiryDate: receiveExpiry || null,
        costPrice: cost,
        userId: currentUser?.id || null,
        note: receiveNote.trim() || 'Goods received',
      });
      setReceiveQty('1');
      setReceiveBatch('');
      setReceiveNote('');
      await loadHistory();
      await refreshLocationStock();
      onStockChanged();
      void triggerPushSync('inventory-receive');
      flash(isPendingStockReceipt(received)
        ? `${product.name} is waiting for a cashier to confirm the goods are present. Stock was not added.`
        : `Received ${receiveQty} of ${product.name}.`);
    } catch (receiveError) {
      flash(receiveError instanceof Error ? receiveError.message : 'Could not record the receipt.', true);
    } finally {
      setBusy(false);
    }
  };

  const submitCount = async () => {
    if (!currentStore?.id || !locationId) {
      flash('Choose a location before saving a stock count.', true);
      return;
    }
    const counts = Object.entries(counted)
      .filter(([, value]) => value.trim() !== '')
      .map(([productId, value]) => ({ productId, countedQty: Number(value) }));
    if (counts.length === 0) {
      flash('Enter the counted quantity for at least one product.', true);
      return;
    }
    if (counts.some((line) => !Number.isFinite(line.countedQty) || line.countedQty < 0)) {
      flash('Counted quantities must be zero or greater.', true);
      return;
    }
    setBusy(true);
    try {
      const result = await recordStockCount({
        storeId: currentStore.id,
        locationId,
        userId: currentUser?.id || null,
        counts,
        note: countNote,
      });
      setCounted({});
      setCountNote('');
      await loadHistory();
      await refreshLocationStock();
      onStockChanged();
      void triggerPushSync('inventory-stock-count');
      flash(result.pending > 0
        ? `Stock count saved. ${result.adjusted} reduced, ${result.pending} increase${result.pending === 1 ? '' : 's'} waiting for cashier approval, ${result.unchanged} already matched.`
        : `Stock count saved. ${result.adjusted} adjusted, ${result.unchanged} already matched.`);
    } catch (countError) {
      flash(countError instanceof Error ? countError.message : 'Could not save the stock count.', true);
    } finally {
      setBusy(false);
    }
  };

  const chosenLabels = activeProducts.filter((product) => selectedLabels[product.id]);

  const printLabels = async () => {
    if (chosenLabels.length === 0) {
      flash('Select at least one product to print.', true);
      return;
    }
    const copies = Math.max(1, Math.min(20, Number(labelCopies) || 1));
    setBusy(true);
    try {
      for (const product of chosenLabels) {
        for (let copy = 0; copy < copies; copy += 1) {
          await printBarcodeLabel(product, currentStore?.name || 'Store', currentStore?.currency_code);
        }
      }
      flash(`Sent ${chosenLabels.length * copies} label${chosenLabels.length * copies === 1 ? '' : 's'} to the printer.`);
    } catch {
      downloadBarcodeLabels(chosenLabels, currentStore?.name || 'Store', currentStore?.currency_code, copies);
      flash('No printer connected. Downloaded a label PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';

  return (
    <section className="space-y-3" aria-label="Inventory tools">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => { setTab(item.id); setError(''); setMessage(''); }}
            className={`rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap touch-target ${
              tab === item.id ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {locations.length > 1 && (tab === 'receive' || tab === 'count') && (
        <label className="block text-xs font-medium text-gray-600">
          Location
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className={`${inputClass} mt-1 bg-white`}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.location_type})
              </option>
            ))}
          </select>
        </label>
      )}
      {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {tab === 'history' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search product, receipt, sale, or count…"
              aria-label="Search inventory history"
              className={`${inputClass} pl-9`}
            />
          </div>
          <p className="text-[11px] text-gray-500">
            Past receipts, sales, transfers, adjustments, and stock counts on this device.
          </p>
          {filteredHistory.length === 0 ? (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No inventory history matches this search.</p>
          ) : filteredHistory.map((movement) => (
            <article key={movement.id} className="rounded-xl border border-gray-100 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {productNames.get(movement.product_id) || 'Removed product'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {movementLabel(movement.movement_type, movement.note || '')}
                    {movement.note ? ` · ${movement.note}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-gray-900">{movement.quantity}</p>
                  <p className="text-[10px] text-gray-500">{new Date(movement.created_at).toLocaleString()}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'receive' && (
        <form
          className="space-y-3 rounded-xl border border-gray-100 bg-white p-4"
          onSubmit={(event) => { event.preventDefault(); void submitReceive(); }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <PackagePlus className="h-4 w-4 text-primary" />
            Goods receiving
          </div>
          <p className="text-xs text-gray-500">Record stock that arrived. This updates on-hand quantity and inventory history.</p>
          <label className="block text-xs font-medium text-gray-600">
            Product
            <select
              required
              value={receiveProductId}
              onChange={(event) => setReceiveProductId(event.target.value)}
              className={`${inputClass} mt-1 bg-white`}
            >
              <option value="">Select a product</option>
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-600">
              Quantity
              <input
                required
                type="number"
                min="1"
                value={receiveQty}
                onChange={(event) => setReceiveQty(event.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Cost (optional)
              <input
                type="number"
                min="0"
                step="0.01"
                value={receiveCost}
                onChange={(event) => setReceiveCost(event.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-600">
              Batch code
              <input value={receiveBatch} onChange={(event) => setReceiveBatch(event.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Expiry
              <input type="date" value={receiveExpiry} onChange={(event) => setReceiveExpiry(event.target.value)} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className="block text-xs font-medium text-gray-600">
            Note
            <input
              value={receiveNote}
              onChange={(event) => setReceiveNote(event.target.value)}
              placeholder="Supplier or delivery reference"
              className={`${inputClass} mt-1`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || activeProducts.length === 0}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Record receipt'}
          </button>
        </form>
      )}

      {tab === 'count' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Stock count
          </div>
          <p className="text-xs text-gray-500">
            Enter the quantity you counted. Blank rows are skipped. Saving adjusts only the products that differ from the system.
          </p>
          <input
            value={countQuery}
            onChange={(event) => setCountQuery(event.target.value)}
            placeholder="Find a product to count"
            aria-label="Search products to count"
            className={inputClass}
          />
          <label className="block text-xs font-medium text-gray-600">
            Count note
            <input
              value={countNote}
              onChange={(event) => setCountNote(event.target.value)}
              placeholder="Shelf, aisle, or reason"
              className={`${inputClass} mt-1`}
            />
          </label>
          <div className="space-y-2">
            {countProducts.slice(0, 80).map((product) => (
              <label key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{product.name}</span>
                  <span className="text-[11px] text-gray-500">On hand here: {locationStock[product.id] ?? 0}</span>
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={counted[product.id] || ''}
                  onChange={(event) => setCounted((current) => ({ ...current, [product.id]: event.target.value }))}
                  placeholder="Counted"
                  aria-label={`Counted quantity for ${product.name}`}
                  className="w-24 rounded-lg border border-gray-200 px-2 py-2 text-sm"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitCount()}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save stock count'}
          </button>
        </div>
      )}

      {tab === 'labels' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Printer className="h-4 w-4 text-primary" />
            Label printing
          </div>
          <p className="text-xs text-gray-500">
            Print shelf labels for the selected products. Without a connected printer, the labels download as a PDF.
          </p>
          <div className="flex gap-2">
            <input
              value={labelQuery}
              onChange={(event) => setLabelQuery(event.target.value)}
              placeholder="Find products to label"
              aria-label="Search products for labels"
              className={inputClass}
            />
            <input
              type="number"
              min="1"
              max="20"
              value={labelCopies}
              onChange={(event) => setLabelCopies(event.target.value)}
              aria-label="Copies per product"
              className="w-20 rounded-xl border border-gray-200 px-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            {labelProducts.slice(0, 80).map((product) => (
              <label key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(selectedLabels[product.id])}
                  onChange={(event) => setSelectedLabels((current) => ({ ...current, [product.id]: event.target.checked }))}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{product.name}</span>
                <span className="text-[11px] text-gray-500">{product.barcode || 'No barcode'}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void printLabels()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            <button
              type="button"
              disabled={chosenLabels.length === 0}
              onClick={() => {
                downloadBarcodeLabels(
                  chosenLabels,
                  currentStore?.name || 'Store',
                  currentStore?.currency_code,
                  Math.max(1, Math.min(20, Number(labelCopies) || 1))
                );
                flash(`Downloaded labels for ${chosenLabels.length} product${chosenLabels.length === 1 ? '' : 's'}.`);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-800 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

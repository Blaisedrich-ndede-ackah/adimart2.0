import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  Copy,
  History,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';
import { db, generateId, listLocalStores, type LocalProduct, type LocalStockMovement, type LocalStore } from '@/lib/dexie';
import { BRANCH_TRANSFER_NOTE_PREFIX, transferStockBetweenStores } from '@/lib/warehouse';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerPushSync } from '@/lib/sync';

export interface BranchTransferPanelProps {
  /** Heading shown above the transfer controls. */
  title?: string;
  /** Show the transfer history / audit trail table underneath. */
  showHistory?: boolean;
  /** Render collapsed until the owner opens it. */
  collapsible?: boolean;
  /** Called after a successful transfer so the host page can refresh. */
  onTransferred?: () => void;
  className?: string;
}

interface TransferHistoryEntry extends LocalStockMovement {
  productName: string;
  sourceStoreName: string;
  destinationStoreName: string;
}

interface PendingTransfer {
  resolvedItems: Array<{ sourceProductId: string; destinationProductId: string; quantity: number }>;
  missingItems: LocalProduct[];
}

type TransferStatus = 'idle' | 'validating' | 'moving' | 'complete';

/**
 * Branch inventory transfer between two stores linked to the same owner
 * account. Shared by Settings → My Stores and the Branch inventory tab so
 * both screens behave identically.
 *
 * - pick a source and a destination store
 * - tick several products and type the quantity to move for each one
 * - items the destination does not stock yet are listed for approval before
 *   a new stock entry is created for them
 * - the source is deducted, the destination credited, and every move is
 *   written to the transfer history
 */
export default function BranchTransferPanel({
  title = 'Branch inventory transfer',
  showHistory = true,
  collapsible = false,
  onTransferred,
  className = '',
}: BranchTransferPanelProps) {
  const { currentUser } = useAuthStore();

  const [stores, setStores] = useState<LocalStore[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [destinationStoreId, setDestinationStoreId] = useState('');
  const [selectedTransferItems, setSelectedTransferItems] = useState<Record<string, number>>({});
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle');
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferHistory, setTransferHistory] = useState<TransferHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [expanded, setExpanded] = useState(!collapsible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const flash = useCallback((message: string, isError = false) => {
    if (isError) {
      setError(message);
      setSuccess('');
    } else {
      setSuccess(message);
      setError('');
    }
    window.setTimeout(() => {
      setError('');
      setSuccess('');
    }, 4000);
  }, []);

  const loadTransferHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const linkedStores = await listLocalStores();
      const linkedIds = new Set(linkedStores.map((store) => store.id));
      const movements = await db.stock_movements
        .where('movement_type')
        .equals('transfer')
        .toArray();
      // In-store transfers (Branch inventory → Transfer) use the same movement
      // type, so only the ones carrying the branch marker are shown here.
      const branchMovements = movements.filter(
        (movement) =>
          linkedIds.has(movement.store_id) &&
          typeof movement.note === 'string' &&
          movement.note.includes(BRANCH_TRANSFER_NOTE_PREFIX)
      );
      const productIds = [...new Set(branchMovements.map((m) => m.product_id))];
      const productMap = new Map<string, LocalProduct>();
      for (const pid of productIds) {
        const p = await db.products.get(pid);
        if (p) productMap.set(pid, p);
      }
      const sorted: TransferHistoryEntry[] = branchMovements
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((m) => {
          // The note carries the route: "Branch transfer: From -> To"
          const markerIndex = m.note.indexOf(BRANCH_TRANSFER_NOTE_PREFIX);
          const route = m.note.slice(markerIndex + BRANCH_TRANSFER_NOTE_PREFIX.length).trim();
          const [sourceStoreName, destinationStoreName] = route.split('->').map((part) => part.trim());
          return {
            ...m,
            productName: productMap.get(m.product_id)?.name || 'Unknown product',
            sourceStoreName: sourceStoreName || 'Source store',
            destinationStoreName: destinationStoreName || 'Destination store',
          };
        });
      setTransferHistory(sorted);
    } catch {
      setTransferHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const localStores = await listLocalStores();
    setStores(localStores);
    setProducts(await db.products.toArray());
    await loadTransferHistory();
  }, [loadTransferHistory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sourceProducts = useMemo(
    () => products.filter((product) => product.store_id === sourceStoreId && product.is_active === 1),
    [products, sourceStoreId]
  );

  const visibleSourceProducts = useMemo(() => {
    const needle = transferSearch.trim().toLowerCase();
    const withStock = sourceProducts.filter((product) => product.stock_level > 0);
    if (!needle) return withStock;
    return withStock.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.category || '').toLowerCase().includes(needle) ||
        (product.barcode || '').toLowerCase().includes(needle)
    );
  }, [sourceProducts, transferSearch]);

  const toggleTransferItem = (productId: string, qty: number) => {
    setSelectedTransferItems((current) => {
      const next = { ...current };
      if (next[productId]) {
        if (qty <= 0) delete next[productId];
        else next[productId] = qty;
      } else if (qty > 0) {
        next[productId] = qty;
      }
      return next;
    });
  };

  const updateTransferQuantity = (productId: string, value: string) => {
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty <= 0) {
      setSelectedTransferItems((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });
      return;
    }
    setSelectedTransferItems((current) => ({ ...current, [productId]: qty }));
  };

  /** Same item at the destination: same name, or same barcode if it was renamed. */
  const matchDestinationProduct = (
    destinationProducts: LocalProduct[],
    product: LocalProduct
  ): string | null => {
    const match = destinationProducts.find((candidate) => {
      if (candidate.is_active !== 1) return false;
      const sameName = candidate.name.toLowerCase().trim() === product.name.toLowerCase().trim();
      const sameBarcode = !!product.barcode && candidate.barcode === product.barcode;
      return sameName || sameBarcode;
    });
    return match ? match.id : null;
  };

  const createProductAtDestination = async (product: LocalProduct): Promise<string> => {
    const newId = generateId();
    const now = new Date().toISOString();
    await db.products.add({
      id: newId,
      store_id: destinationStoreId,
      name: product.name,
      category: product.category,
      sku_type: product.sku_type,
      barcode: product.barcode,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      stock_level: 0,
      is_active: 1,
      image_url: product.image_url,
      pack_size: product.pack_size,
      track_expiry: product.track_expiry,
      wholesale_mode: product.wholesale_mode,
      wholesale_pack_price: product.wholesale_pack_price,
      wholesale_unit_price: product.wholesale_unit_price,
      wholesale_tiers_json: product.wholesale_tiers_json,
      sell_online: product.sell_online,
      reorder_level: product.reorder_level,
      created_at: now,
      updated_at: now,
      synced: 0,
    });
    return newId;
  };

  /** Moves the resolved items, creating any missing destination entries first. */
  const runBranchTransfer = async (
    resolvedItems: Array<{ sourceProductId: string; destinationProductId: string; quantity: number }>,
    productsToCreate: LocalProduct[]
  ) => {
    setBusy(true);
    setTransferStatus('validating');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setTransferStatus('moving');

      const createdProductMap = new Map<string, string>();
      for (const product of productsToCreate) {
        const newId = await createProductAtDestination(product);
        createdProductMap.set(product.id, newId);
      }

      const finalItems = resolvedItems.map((item) => ({
        ...item,
        destinationProductId: createdProductMap.get(item.sourceProductId) || item.destinationProductId,
      }));

      const sourceName = stores.find((s) => s.id === sourceStoreId)?.name || 'source store';
      const destinationName = stores.find((s) => s.id === destinationStoreId)?.name || 'destination store';

      // Execute transfers sequentially to maintain atomicity per item
      for (const item of finalItems) {
        await transferStockBetweenStores({
          sourceStoreId,
          destinationStoreId,
          sourceProductId: item.sourceProductId,
          destinationProductId: item.destinationProductId,
          quantity: item.quantity,
          userId: currentUser?.id,
          sourceStoreName: sourceName,
          destinationStoreName: destinationName,
        });
      }

      await refresh();
      setSelectedTransferItems({});
      setPendingTransfer(null);
      setTransferStatus('complete');
      flash(
        `Transfer completed: ${finalItems.length} item(s) moved from ${sourceName} to ${destinationName}. Source stock deducted and destination stock merged.`
      );
      void triggerPushSync('branch-transfer');
      onTransferred?.();
      window.setTimeout(() => setTransferStatus('idle'), 2500);
    } catch (e) {
      setTransferStatus('idle');
      flash(e instanceof Error ? e.message : 'Transfer failed', true);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkTransfer = async () => {
    if (!sourceStoreId || !destinationStoreId) {
      flash('Choose both source and destination stores.', true);
      return;
    }
    if (sourceStoreId === destinationStoreId) {
      flash('Source and destination stores must be different.', true);
      return;
    }
    const items = Object.entries(selectedTransferItems);
    if (items.length === 0) {
      flash('Select at least one product and quantity to transfer.', true);
      return;
    }

    // Validate quantities and check stock availability
    const sourceList = products.filter((p) => p.store_id === sourceStoreId && p.is_active === 1);
    for (const [productId, qty] of items) {
      const product = sourceList.find((p) => p.id === productId);
      if (!product) {
        flash('One of the selected products is no longer available at the source store.', true);
        return;
      }
      if (qty > product.stock_level) {
        flash(`Insufficient stock for "${product.name}" (available: ${product.stock_level}).`, true);
        return;
      }
    }

    // Resolve destination product IDs — items that do not exist at the
    // destination are collected so the owner can approve creating them.
    const resolvedItems: Array<{ sourceProductId: string; destinationProductId: string; quantity: number }> = [];
    const productsToCreate: LocalProduct[] = [];

    // One read for the whole batch instead of one per item.
    const destinationProducts = await db.products
      .where('store_id')
      .equals(destinationStoreId)
      .toArray();

    for (const [sourceProductId, quantity] of items) {
      const sourceProduct = sourceList.find((p) => p.id === sourceProductId)!;
      const destProductId = matchDestinationProduct(destinationProducts, sourceProduct);
      if (destProductId) {
        resolvedItems.push({ sourceProductId, destinationProductId: destProductId, quantity });
      } else {
        productsToCreate.push(sourceProduct);
        resolvedItems.push({ sourceProductId, destinationProductId: '', quantity }); // placeholder
      }
    }

    if (productsToCreate.length > 0) {
      setPendingTransfer({ resolvedItems, missingItems: productsToCreate });
      return;
    }

    await runBranchTransfer(resolvedItems, []);
  };

  /** Owner approved creating the missing destination stock entries. */
  const confirmCreateMissingItems = async () => {
    if (!pendingTransfer) return;
    await runBranchTransfer(pendingTransfer.resolvedItems, pendingTransfer.missingItems);
  };

  const cancelPendingTransfer = () => {
    setPendingTransfer(null);
  };

  const destinationName =
    stores.find((store) => store.id === destinationStoreId)?.name || 'the destination store';
  const selectedCount = Object.keys(selectedTransferItems).length;

  if (stores.length < 2) {
    return (
      <div className={`rounded-2xl border border-gray-200 bg-white p-4 ${className}`}>
        <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
          <Boxes className="h-4 w-4 text-emerald-700" /> {title}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          Link a second store from Settings → My Stores to move stock between branches.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <Boxes className="h-4 w-4 text-emerald-700" /> {title}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            Move stock between any stores linked to this owner account. Every transfer deducts the source first and records the matching addition at the destination.
          </p>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-2.5 py-2 text-[11px] font-bold text-white"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            {expanded ? 'Close' : 'Transfer stock'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {(error || success) && (
            <div
              role={error ? 'alert' : 'status'}
              className={`rounded-xl px-3 py-2 text-[11px] ${
                error
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              }`}
            >
              {error || success}
            </div>
          )}

          {transferStatus !== 'idle' && (
            <div
              className={`rounded-xl border p-3 ${
                transferStatus === 'complete' ? 'border-emerald-200 bg-emerald-50' : 'border-sky-200 bg-sky-50'
              }`}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                {transferStatus === 'complete' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900">
                    {transferStatus === 'validating'
                      ? 'Validating linked stores'
                      : transferStatus === 'moving'
                        ? 'Moving inventory securely'
                        : 'Transfer complete'}
                  </p>
                  <p className="text-[11px] text-gray-600">
                    {transferStatus === 'complete'
                      ? 'Source stock deducted and destination stock merged.'
                      : 'Checking stock, deducting the source, and adding to the destination atomically.'}
                  </p>
                </div>
              </div>
              {transferStatus !== 'complete' && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full rounded-full bg-sky-600 transition-all duration-700 ${
                      transferStatus === 'validating' ? 'w-1/3' : 'w-full'
                    }`}
                  />
                </div>
              )}
            </div>
          )}

          {/* Store selectors */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-gray-600">
              From store
              <select
                value={sourceStoreId}
                onChange={(event) => {
                  setSourceStoreId(event.target.value);
                  setSelectedTransferItems({});
                  setPendingTransfer(null);
                }}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
              >
                <option value="">Select source store</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-gray-600">
              To store
              <select
                value={destinationStoreId}
                onChange={(event) => {
                  setDestinationStoreId(event.target.value);
                  setSelectedTransferItems({});
                  setPendingTransfer(null);
                }}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
              >
                <option value="">Select destination store</option>
                {stores
                  .filter((store) => store.id !== sourceStoreId)
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {/* Multi-product selection grid */}
          {sourceStoreId && (
            <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  Select products to transfer
                </h4>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    placeholder="Search products…"
                    className="w-full rounded-lg pl-8 pr-3 py-1.5 border border-gray-200 bg-gray-50 text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-8">
                        Select
                      </th>
                      <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase">
                        Product
                      </th>
                      <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-24">
                        Available
                      </th>
                      <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-32">
                        Qty to transfer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSourceProducts.map((product) => {
                      const isSelected = !!selectedTransferItems[product.id];
                      const qty = selectedTransferItems[product.id] || 0;
                      return (
                        <tr
                          key={product.id}
                          className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                            isSelected ? 'bg-emerald-50 border-r border-emerald-200' : ''
                          }`}
                        >
                          <td className="pb-2 pt-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) =>
                                toggleTransferItem(product.id, e.target.checked ? qty || 1 : 0)
                              }
                              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                          </td>
                          <td className="pb-2 pt-2">
                            <div className="font-medium text-gray-900">{product.name}</div>
                            <div className="text-[10px] text-gray-500">
                              {product.category || 'Uncategorized'}
                            </div>
                          </td>
                          <td className="pb-2 pt-2">
                            <span className="font-semibold text-gray-700">{product.stock_level}</span>
                          </td>
                          <td className="pb-2 pt-2">
                            <input
                              type="number"
                              min={1}
                              max={product.stock_level}
                              step={1}
                              value={qty || ''}
                              onChange={(e) => updateTransferQuantity(product.id, e.target.value)}
                              placeholder="0"
                              disabled={!isSelected}
                              className={`w-full rounded-lg border px-2 py-1.5 text-xs text-center ${
                                isSelected
                                  ? 'border-emerald-300 bg-white focus:ring-1 focus:ring-emerald-400 outline-none'
                                  : 'border-gray-200 bg-gray-50 text-gray-400'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {visibleSourceProducts.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[11px] text-gray-400">
                          {transferSearch.trim()
                            ? 'No product matches that search.'
                            : 'This store has no stock available to transfer.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Transfer summary bar */}
          {selectedCount > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    Transfer summary
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    {selectedCount} item(s) to {destinationName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTransferItems({})}
                  className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 underline"
                >
                  Clear selection
                </button>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(selectedTransferItems).map(([productId, qty]) => {
                  const product = sourceProducts.find((p) => p.id === productId);
                  if (!product) return null;
                  return (
                    <div
                      key={productId}
                      className="flex items-center justify-between bg-white px-2 py-1 rounded-lg border border-gray-100"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-900 truncate w-24">{product.name}</span>
                        <span className="text-[10px] text-gray-500">× {qty}</span>
                      </div>
                      <span className="text-xs font-bold text-emerald-700">
                        {product.stock_level - qty} remaining
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stock that does not exist at the destination yet — ask before creating it */}
          {pendingTransfer && pendingTransfer.missingItems.length > 0 && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-900">
                    {pendingTransfer.missingItems.length} item(s) do not exist at {destinationName} yet
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                    Create them as new stock entries there, then merge the incoming quantity into them?
                  </p>
                </div>
              </div>
              <ul className="space-y-1">
                {pendingTransfer.missingItems.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center justify-between rounded-lg border border-amber-100 bg-white px-2.5 py-1.5"
                  >
                    <span className="truncate text-xs text-gray-900">{product.name}</span>
                    <span className="text-[10px] font-semibold text-amber-700">
                      × {selectedTransferItems[product.id] || 0}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmCreateMissingItems()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create and transfer
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelPendingTransfer}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[11px] font-bold text-amber-800 disabled:opacity-50"
                >
                  Cancel transfer
                </button>
              </div>
            </div>
          )}

          {/* Confirm transfer button */}
          <button
            type="button"
            disabled={busy || pendingTransfer !== null || selectedCount === 0 || !destinationStoreId}
            onClick={() => void handleBulkTransfer()}
            className={`w-full rounded-xl py-2.5 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
              selectedCount > 0 && destinationStoreId
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-gray-200 text-gray-500'
            }`}
          >
            {busy ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              <span className="inline-flex items-center justify-center">
                <Copy className="h-4 w-4 mr-2" />
                Transfer {selectedCount} item(s)
              </span>
            )}
          </button>

          {/* Transfer history / audit trail */}
          {showHistory && (
            <div className="mt-4 rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-gray-500" />
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                    Transfer history
                  </h4>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search history…"
                    className="w-full rounded-lg pl-7 pr-3 py-1.5 border border-gray-200 bg-gray-50 text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-20">
                        Date
                      </th>
                      <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-20">
                        Product
                      </th>
                      <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-16">
                        Qty
                      </th>
                      <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-24">
                        From → To
                      </th>
                      <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyLoading ? (
                      <tr>
                        <td colSpan={5} className="h-24 text-center text-gray-400 text-[10px]">
                          Loading history…
                        </td>
                      </tr>
                    ) : transferHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="h-24 text-center text-gray-400 text-[10px]">
                          No transfers recorded yet. Start a transfer to see activity here.
                        </td>
                      </tr>
                    ) : (
                      transferHistory
                        .filter((entry) => {
                          const needle = historySearch.toLowerCase();
                          if (!needle) return true;
                          return (
                            entry.productName.toLowerCase().includes(needle) ||
                            entry.sourceStoreName.toLowerCase().includes(needle) ||
                            entry.destinationStoreName.toLowerCase().includes(needle)
                          );
                        })
                        .map((entry) => (
                          <tr
                            key={entry.id}
                            className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                          >
                            <td className="pb-2 pt-2 text-gray-700">
                              {new Date(entry.created_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="pb-2 pt-2 text-gray-700 font-medium">{entry.productName}</td>
                            <td className="pb-2 pt-2">
                              <span className="font-bold text-amber-700">{entry.quantity}</span>
                            </td>
                            <td className="pb-2 pt-2 text-gray-600">
                              <span className="font-medium text-gray-800">{entry.sourceStoreName}</span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className="font-medium text-gray-800">
                                {entry.destinationStoreName}
                              </span>
                            </td>
                            <td className="pb-2 pt-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Completed
                              </span>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

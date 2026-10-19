import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Loader2,
  Plus,
  CloudDownload,
  CheckCircle2,
  ArrowRightLeft,
  Boxes,
  History,
  Search,
  Copy,
} from 'lucide-react';
import { db, type LocalProduct, type LocalStockMovement } from '@/lib/dexie';
import { transferStockBetweenStores } from '@/lib/warehouse';
import {
  addStoreFromCloud,
  assertCanCreateAdditionalStore,
  createStoreWithOwner,
  getAdditionalStoreQuota,
  listLocalStores,
  type LocalStore,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Owner multi-store portal: open another store on this device to manage
 * that store's inventory and staff after signing in.
 */
export default function StoresPortalSection() {
  const { currentStore, switchStore, currentUser, refreshStore } = useAuthStore();
  const [stores, setStores] = useState<LocalStore[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddCloud, setShowAddCloud] = useState(false);
  const [quotaLabel, setQuotaLabel] = useState('');
  const [canCreateStore, setCanCreateStore] = useState(true);

  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [ownerName, setOwnerName] = useState(currentUser?.name || '');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [cloudStoreId, setCloudStoreId] = useState('');
  const [cloudPin, setCloudPin] = useState('');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [destinationStoreId, setDestinationStoreId] = useState('');
  const [selectedTransferItems, setSelectedTransferItems] = useState<Record<string, number>>({});
  const [showBranchTransfer, setShowBranchTransfer] = useState(false);
  const [transferStatus, setTransferStatus] = useState<'idle' | 'validating' | 'moving' | 'complete'>('idle');
  interface TransferHistoryEntry extends LocalStockMovement {
    productName: string;
  }

  const [transferHistory, setTransferHistory] = useState<TransferHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  const refresh = useCallback(async () => {
    const localStores = await listLocalStores();
    setStores(localStores);
    setProducts(await db.products.toArray());
    await refreshStore();
    const phoneHint =
      currentUser?.phone || currentStore?.support_number || newPhone || '';
    const quota = await getAdditionalStoreQuota(phoneHint);
    setCanCreateStore(quota.canCreate);
    setQuotaLabel(`${quota.ownedCount}/${quota.maxStores} stores allowed`);
    void loadTransferHistory();
  }, [currentStore?.support_number, currentUser?.phone, newPhone, refreshStore]);

  interface TransferHistoryEntry extends LocalStockMovement {
    productName: string;
  }

  const loadTransferHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const movements = await db.stock_movements
        .where('movement_type')
        .equals('transfer')
        .toArray();
      // Get all product IDs to look up names
      const productIds = [...new Set(movements.map((m) => m.product_id))];
      const productMap = new Map<string, LocalProduct>();
      for (const pid of productIds) {
        const p = await db.products.get(pid);
        if (p) productMap.set(pid, p);
      }
      const sorted: TransferHistoryEntry[] = movements
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((m) => ({ ...m, productName: productMap.get(m.product_id)?.name || 'Unknown product' }));
      setTransferHistory(sorted);
    } catch {
      setTransferHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, currentStore?.id]);

  const flash = (text: string, isError = false) => {
    if (isError) {
      setError(text);
      setMsg('');
    } else {
      setMsg(text);
      setError('');
    }
    setTimeout(() => {
      setMsg('');
      setError('');
    }, 4000);
  };

  const handleOpenStore = async (storeId: string) => {
    if (storeId === currentStore?.id) return;
    if (
      !confirm(
        'Switch to this store? You will sign out and must enter a PIN for that store. Its inventory and staff will load after login.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await switchStore(storeId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not switch store', true);
    }
    setBusy(false);
  };

  const handleCreate = async () => {
    setError('');
    if (!newName.trim() || !newAddress.trim() || !isValidGhanaPhone(newPhone)) {
      flash('Enter store name, address, and a valid Ghana phone number.', true);
      return;
    }
    if (!ownerName.trim()) {
      flash('Enter the owner name for this store.', true);
      return;
    }
    if (ownerPin.length !== 4 || ownerPin !== confirmPin) {
      flash('Enter matching 4-digit owner PINs.', true);
      return;
    }
    setBusy(true);
    try {
      await assertCanCreateAdditionalStore(newPhone.trim());
      const { store } = await createStoreWithOwner(
        newName.trim(),
        ownerName.trim(),
        ownerPin,
        {
          address: newAddress.trim(),
          supportNumber: newPhone.trim(),
          ownerPhone: newPhone.trim(),
        }
      );
      await switchStore(store.id);
      setShowCreate(false);
      setNewName('');
      setNewAddress('');
      setNewPhone('');
      setOwnerPin('');
      setConfirmPin('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create store', true);
      setBusy(false);
    }
  };

  const sourceProducts = useMemo(
    () => products.filter((product) => product.store_id === sourceStoreId && product.is_active === 1),
    [products, sourceStoreId]
  );
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

  const findProductAtDestination = async (product: LocalProduct): Promise<string | null> => {
    const destinationProducts = await db.products
      .where('store_id')
      .equals(destinationStoreId)
      .toArray();
    const match = destinationProducts.find(
      (p) => p.name.toLowerCase().trim() === product.name.toLowerCase().trim() && p.is_active === 1
    );
    return match ? match.id : null;
  };

  const createProductAtDestination = async (product: LocalProduct): Promise<string> => {
    const newId = crypto.randomUUID();
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: 0,
    });
    return newId;
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
    const sourceProducts = products.filter((p) => p.store_id === sourceStoreId && p.is_active === 1);
    for (const [productId, qty] of items) {
      const product = sourceProducts.find((p) => p.id === productId);
      if (!product) {
        flash(`One of the selected products is no longer available at the source store.`, true);
        return;
      }
      if (qty > product.stock_level) {
        flash(`Insufficient stock for "${product.name}" (available: ${product.stock_level}).`, true);
        return;
      }
    }

    setBusy(true);
    setTransferStatus('validating');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setTransferStatus('moving');

      // Resolve destination product IDs — create missing ones first
      const resolvedItems: Array<{ sourceProductId: string; destinationProductId: string; quantity: number }> = [];
      const productsToCreate: LocalProduct[] = [];

      for (const [sourceProductId, quantity] of items) {
        const sourceProduct = sourceProducts.find((p) => p.id === sourceProductId)!;
        const destProductId = await findProductAtDestination(sourceProduct);
        if (destProductId) {
          resolvedItems.push({ sourceProductId, destinationProductId: destProductId, quantity });
        } else {
          productsToCreate.push(sourceProduct);
          resolvedItems.push({ sourceProductId, destinationProductId: '', quantity }); // placeholder
        }
      }

      // Create missing products at destination
      const createdProductMap = new Map<string, string>();
      for (const product of productsToCreate) {
        const newId = await createProductAtDestination(product);
        createdProductMap.set(product.id, newId);
      }

      // Finalize resolved items with created product IDs
      const finalItems = resolvedItems.map((item) => ({
        ...item,
        destinationProductId: createdProductMap.get(item.sourceProductId) || item.destinationProductId,
      }));

      // Execute transfers sequentially to maintain atomicity per item
      for (const item of finalItems) {
        await transferStockBetweenStores({
          sourceStoreId,
          destinationStoreId,
          sourceProductId: item.sourceProductId,
          destinationProductId: item.destinationProductId,
          quantity: item.quantity,
          userId: currentUser?.id,
          note: `Branch inventory transfer from ${sourceStoreId} to ${destinationStoreId}`,
        });
      }

      await refresh();
      setSelectedTransferItems({});
      setTransferStatus('complete');
      flash(
        `Bulk transfer completed: ${items.length} item(s) moved. Source stock deducted and destination stock merged.`,
        false
      );
      window.setTimeout(() => setTransferStatus('idle'), 2500);
    } catch (e) {
      setTransferStatus('idle');
      flash(e instanceof Error ? e.message : 'Bulk transfer failed', true);
    } finally {
      setBusy(false);
    }
  };

  const handleAddCloud = async () => {
    setError('');
    if (!cloudStoreId.trim() || cloudPin.length !== 4) {
      flash('Enter Store ID and owner PIN.', true);
      return;
    }
    setBusy(true);
    const result = await addStoreFromCloud(cloudStoreId.trim(), cloudPin);
    if (!result.success) {
      flash(result.message, true);
      setBusy(false);
      return;
    }
    await switchStore(cloudStoreId.trim());
    setShowAddCloud(false);
    setCloudStoreId('');
    setCloudPin('');
    // switchStore clears auth — component may unmount via App
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-gray-900">My Stores</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Link unlimited existing stores to this owner account with each Store ID and its 4-digit owner PIN. Linked stores stay available in Branch inventory for secure stock transfers.
        {quotaLabel ? ` New store creation: ${quotaLabel}.` : ''}
      </p>

      <div className="space-y-2 mb-3">
        {stores.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center">
            <p className="text-xs text-gray-600">No linked stores yet. Use the button below to link your first store.</p>
          </div>
        ) : (
          stores.map((store) => {
            const active = store.id === currentStore?.id;
            return (
              <div
                key={store.id}
                className={`rounded-xl border px-3 py-3 ${
                  active ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Store / branch name</p>
                <p className="font-semibold text-gray-900 truncate">{store.name}</p>
                <p className="text-[11px] text-gray-500 truncate">{store.address || 'No address'}</p>
                    <p className="text-[11px] text-gray-500 truncate">{store.support_number || 'No phone'}</p>
                    {active && (
                      <p className="text-[10px] font-bold uppercase tracking-wide text-primary mt-1">
                        Current store
                      </p>
                    )}
                  </div>
                  {!active && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleOpenStore(store.id)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white touch-target disabled:opacity-50"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      Open
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {stores.length > 1 && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                <Boxes className="h-4 w-4 text-emerald-700" /> Branch inventory
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                Move stock between any stores linked to this owner account. Every transfer deducts the source first and records the matching addition at the destination.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBranchTransfer((value) => !value)}
              className="shrink-0 rounded-lg bg-emerald-700 px-2.5 py-2 text-[11px] font-bold text-white"
            >
              {showBranchTransfer ? 'Close' : 'Transfer'}
            </button>
          </div>
          {showBranchTransfer && (
            <div className="mt-3 space-y-3">
              {transferStatus !== 'idle' && (
                <div className={`rounded-xl border p-3 ${transferStatus === 'complete' ? 'border-emerald-200 bg-emerald-50' : 'border-sky-200 bg-sky-50'}`} role="status" aria-live="polite">
                  <div className="flex items-center gap-3">
                    {transferStatus === 'complete' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Loader2 className="h-5 w-5 animate-spin text-sky-700" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900">{transferStatus === 'validating' ? 'Validating linked stores' : transferStatus === 'moving' ? 'Moving inventory securely' : 'Transfer complete'}</p>
                      <p className="text-[11px] text-gray-600">{transferStatus === 'complete' ? 'Source and destination stock are now synchronized.' : 'Checking stock, deducting the source, and adding to the destination atomically.'}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full bg-sky-600 transition-all duration-700 ${transferStatus === 'validating' ? 'w-1/3' : 'w-full'}`} /></div>
                </div>
              )}

              {/* Store selectors */}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold text-gray-600">
                  From store
                  <select
                    value={sourceStoreId}
                    onChange={(event) => setSourceStoreId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Select source store</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
                <label className="block text-[11px] font-semibold text-gray-600">
                  To store
                  <select
                    value={destinationStoreId}
                    onChange={(event) => setDestinationStoreId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Select destination store</option>
                    {stores.filter((store) => store.id !== sourceStoreId).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
              </div>

              {/* Multi-product selection grid */}
              {sourceStoreId && (
                <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Select products to transfer</h4>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search products…"
                        className="w-full rounded-lg pl-8 pr-3 py-1.5 border border-gray-200 bg-gray-50 text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-8">Select</th>
                          <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase">Product</th>
                          <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-24">Available</th>
                          <th className="pb-2 text-left text-[10px] font-medium text-gray-400 uppercase w-32">Qty to transfer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceProducts
                          .filter((p) => p.stock_level > 0)
                          .map((product) => {
                            const isSelected = !!selectedTransferItems[product.id];
                            const qty = selectedTransferItems[product.id] || 0;
                            return (
                              <tr
                                key={product.id}
                                className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-emerald-50 border-r border-emerald-200' : ''}`}
                              >
                                <td className="pb-2 pt-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => toggleTransferItem(product.id, e.target.checked ? qty || 1 : 0)}
                                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                  />
                                </td>
                                <td className="pb-2 pt-2">
                                  <div className="font-medium text-gray-900">{product.name}</div>
                                  <div className="text-[10px] text-gray-500">{product.category || 'Uncategorized'}</div>
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
                                    className={`w-full rounded-lg border px-2 py-1.5 text-xs text-center ${isSelected ? 'border-emerald-300 bg-white focus:ring-1 focus:ring-emerald-400 outline-none' : 'border-gray-200 bg-gray-50 text-gray-400'}`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Transfer summary bar */}
              {Object.keys(selectedTransferItems).length > 0 && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Transfer summary</p>
                      <p className="text-[11px] text-emerald-700">
                        {Object.keys(selectedTransferItems).length} item(s) to {stores.find((s) => s.id === destinationStoreId)?.name || destinationStoreId}
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
                        <div key={productId} className="flex items-center justify-between bg-white px-2 py-1 rounded-lg border border-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-900 truncate w-24">{product.name}</span>
                            <span className="text-[10px] text-gray-500">× {qty}</span>
                          </div>
                          <span className="text-xs font-bold text-emerald-700">{product.stock_level - qty} remaining</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Confirm transfer button */}
              <button
                type="button"
                disabled={busy || Object.keys(selectedTransferItems).length === 0 || !destinationStoreId}
                onClick={() => void handleBulkTransfer()}
                className={`w-full rounded-xl py-2.5 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                  Object.keys(selectedTransferItems).length > 0 && destinationStoreId
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />Bulk transfer stock}
              </button>

              {/* Transfer history / audit trail */}
              <div className="mt-4 rounded-xl border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-gray-500" />
                    <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Transfer history</h4>
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
                        <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-20">Date</th>
                        <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-20">Product</th>
                        <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-16">Qty</th>
                        <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase w-24">From → To</th>
                        <th className="pb-2 pt-3 text-left text-[10px] font-medium text-gray-400 uppercase">Status</th>
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
                            No transfers recorded yet. Start a bulk transfer to see activity here.
                          </td>
                        </tr>
                      ) : (
                        transferHistory
                          .filter((entry) =>
                            entry.productName.toLowerCase().includes(historySearch.toLowerCase())
                          )
                          .map((entry) => (
                            <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                              <td className="pb-2 pt-2 text-gray-700">
                                {new Date(entry.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="pb-2 pt-2 text-gray-700 font-medium">{entry.productName}</td>
                              <td className="pb-2 pt-2">
                                <span className="font-bold text-amber-700">{entry.quantity}</span>
                              </td>
                              <td className="pb-2 pt-2 text-gray-600">{entry.from_location_id ? 'Source → Destination' : 'N/A'}</td>
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
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canCreateStore}
          onClick={() => {
            setShowCreate((v) => !v);
            setShowAddCloud(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 touch-target disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Create store
        </button>
        {!canCreateStore && (
          <p className="w-full text-[11px] text-amber-800">
            Store limit reached. Ask your administrator to allow more stores.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setShowAddCloud((v) => !v);
            setShowCreate(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 touch-target"
        >
          <CloudDownload className="w-3.5 h-3.5" />
          Link existing store
        </button>
      </div>

      {showCreate && canCreateStore && (
        <div className="mt-3 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="text-xs font-semibold text-gray-800">New store profile</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Store name *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Address *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Support phone * (024…)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Owner name *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN *"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm *"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Create & open store'}
          </button>
        </div>
      )}

      {showAddCloud && (
        <div className="mt-3 space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
          <p className="text-xs font-semibold text-gray-800">
            Add to Branch inventory
            <span className="block mt-1 text-[11px] font-normal text-gray-500">
              Enter the Store ID and the 4-digit owner PIN for that store. This adds it without removing your other linked stores.
            </span>
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-gray-600">
              Store ID
              <input
                value={cloudStoreId}
                onChange={(e) => setCloudStoreId(e.target.value)}
                placeholder="Enter Store ID"
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm font-normal"
              />
            </label>
            <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/70 px-3 py-2">
              <p className="text-[11px] font-semibold text-emerald-800">Store / branch name</p>
              <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">After the PIN is verified, the linked store name appears here in your store list.</p>
            </div>
          </div>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={cloudPin}
            onChange={(e) => setCloudPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your 4-digit owner PIN"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAddCloud()}
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Add store to Branch inventory'}
          </button>
        </div>
      )}

      {msg && (
        <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Warehouse,
  MapPin,
  ArrowDownToLine,
  ArrowLeftRight,
  CalendarClock,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
  Store,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  db,
  type LocalLocation,
  type LocalProduct,
  type LocalStockBatch,
} from '@/lib/dexie';
import {
  createLocation,
  ensureStoreLocations,
  getExpiringBatches,
  listLocations,
  receiveStock,
  transferStock,
} from '@/lib/warehouse';

type TabId = 'locations' | 'receive' | 'transfer' | 'expiry';

const TABS: { id: TabId; label: string; icon: typeof Warehouse }[] = [
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'expiry', label: 'Expiry', icon: CalendarClock },
];

function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  return Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyClasses(days: number | null): string {
  if (days == null) return 'bg-gray-50 border-gray-200 text-gray-700';
  if (days < 0) return 'bg-red-50 border-red-200 text-red-800';
  if (days <= 7) return 'bg-red-50 border-red-200 text-red-700';
  if (days <= 14) return 'bg-amber-50 border-amber-200 text-amber-800';
  return 'bg-yellow-50 border-yellow-200 text-yellow-800';
}

function urgencyLabel(days: number | null): string {
  if (days == null) return '';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `${days}d left`;
}

export default function WarehousePage() {
  const { currentStore, currentUser } = useAuthStore();
  const warehouseEnabled = (currentStore?.warehouse_enabled ?? 0) === 1;
  const maxShops = currentStore?.max_shops ?? 1;
  const maxWarehouses = currentStore?.max_warehouses ?? 0;

  const [tab, setTab] = useState<TabId>('locations');
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [expiring, setExpiring] = useState<LocalStockBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add location form
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocName, setNewLocName] = useState('');
  const [newLocType, setNewLocType] = useState<'shop' | 'warehouse'>('shop');

  // Receive form
  const [recvProductId, setRecvProductId] = useState('');
  const [recvLocationId, setRecvLocationId] = useState('');
  const [recvQty, setRecvQty] = useState('');
  const [recvBatch, setRecvBatch] = useState('');
  const [recvExpiry, setRecvExpiry] = useState('');

  // Transfer form
  const [xferFromId, setXferFromId] = useState('');
  const [xferToId, setXferToId] = useState('');
  const [xferProductId, setXferProductId] = useState('');
  const [xferQty, setXferQty] = useState('');

  const productMap = useMemo(() => {
    const map = new Map<string, LocalProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const locationMap = useMemo(() => {
    const map = new Map<string, LocalLocation>();
    for (const l of locations) map.set(l.id, l);
    return map;
  }, [locations]);

  const shopCount = locations.filter((l) => l.location_type === 'shop').length;
  const warehouseCount = locations.filter((l) => l.location_type === 'warehouse').length;
  const canAddShop = shopCount < maxShops;
  const canAddWarehouse = warehouseEnabled && warehouseCount < maxWarehouses;

  const selectedRecvProduct = productMap.get(recvProductId) || null;
  const trackExpiry = (selectedRecvProduct?.track_expiry ?? 0) === 1;

  const flash = (msg: string, isError = false) => {
    if (isError) {
      setError(msg);
      setSuccess('');
    } else {
      setSuccess(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setSuccess('');
    }, 3500);
  };

  const loadAll = useCallback(async () => {
    if (!currentStore?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await ensureStoreLocations(currentStore.id);
      const [locs, prods, batches] = await Promise.all([
        listLocations(currentStore.id),
        db.products
          .where('store_id')
          .equals(currentStore.id)
          .and((p) => p.is_active === 1)
          .toArray(),
        getExpiringBatches(currentStore.id, 30),
      ]);
      locs.sort((a, b) => {
        if (a.location_type !== b.location_type) {
          return a.location_type === 'shop' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      prods.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(locs);
      setProducts(prods);
      setExpiring(batches);

      if (!recvLocationId && locs[0]) setRecvLocationId(locs[0].id);
      if (!xferFromId && locs[0]) setXferFromId(locs[0].id);
      if (!xferToId && locs.length > 1) {
        setXferToId(locs[1].id);
      } else if (!xferToId && locs[0]) {
        setXferToId(locs[0].id);
      }
      if (!recvProductId && prods[0]) setRecvProductId(prods[0].id);
      if (!xferProductId && prods[0]) setXferProductId(prods[0].id);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to load warehouse data', true);
    }
    setLoading(false);
  }, [currentStore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleAddLocation = async () => {
    if (!currentStore?.id) return;
    if (!canAddShop && !canAddWarehouse) {
      flash('Location limits reached', true);
      return;
    }
    const type =
      newLocType === 'warehouse'
        ? canAddWarehouse
          ? 'warehouse'
          : 'shop'
        : canAddShop
          ? 'shop'
          : 'warehouse';
    if (type === 'warehouse' && !canAddWarehouse) {
      flash(`Maximum warehouses reached (${maxWarehouses})`, true);
      return;
    }
    if (type === 'shop' && !canAddShop) {
      flash(`Maximum shops reached (${maxShops})`, true);
      return;
    }

    setBusy(true);
    try {
      await createLocation({
        storeId: currentStore.id,
        name: newLocName.trim() || (type === 'warehouse' ? 'Warehouse' : 'Shop'),
        locationType: type,
      });
      setNewLocName('');
      setShowAddLocation(false);
      flash(`${type === 'warehouse' ? 'Warehouse' : 'Shop'} added`);
      await loadAll();
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to add location', true);
    }
    setBusy(false);
  };

  const handleReceive = async () => {
    if (!currentStore?.id) return;
    const qty = parseInt(recvQty, 10);
    if (!recvProductId) {
      flash('Select a product', true);
      return;
    }
    if (!recvLocationId) {
      flash('Select a location', true);
      return;
    }
    if (!qty || qty <= 0) {
      flash('Enter a valid quantity', true);
      return;
    }

    setBusy(true);
    try {
      await receiveStock({
        storeId: currentStore.id,
        productId: recvProductId,
        locationId: recvLocationId,
        quantity: qty,
        batchCode: recvBatch.trim() || undefined,
        expiryDate: trackExpiry && recvExpiry ? recvExpiry : null,
        userId: currentUser?.id || null,
      });
      setRecvQty('');
      setRecvBatch('');
      setRecvExpiry('');
      flash(`Received ${qty} units`);
      await loadAll();
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Receive failed', true);
    }
    setBusy(false);
  };

  const handleTransfer = async () => {
    if (!currentStore?.id) return;
    const qty = parseInt(xferQty, 10);
    if (!xferProductId) {
      flash('Select a product', true);
      return;
    }
    if (!xferFromId || !xferToId) {
      flash('Select from and to locations', true);
      return;
    }
    if (xferFromId === xferToId) {
      flash('Source and destination must differ', true);
      return;
    }
    if (!qty || qty <= 0) {
      flash('Enter a valid quantity', true);
      return;
    }

    setBusy(true);
    try {
      await transferStock({
        storeId: currentStore.id,
        productId: xferProductId,
        fromLocationId: xferFromId,
        toLocationId: xferToId,
        quantity: qty,
        userId: currentUser?.id || null,
      });
      setXferQty('');
      flash(`Transferred ${qty} units`);
      await loadAll();
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Transfer failed', true);
    }
    setBusy(false);
  };

  if (!warehouseEnabled) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <div className="bg-primary px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-white" />
            <h1 className="text-white font-bold text-lg">Warehouse</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 pb-24">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <Warehouse className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Warehouse not enabled</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              Warehouse not enabled — contact administrator
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-primary px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-white" />
            <div>
              <h1 className="text-white font-bold text-lg">Warehouse</h1>
              <p className="text-emerald-200 text-[10px] mt-0.5">
                {shopCount} shop{shopCount !== 1 ? 's' : ''} · {warehouseCount} warehouse
                {warehouseCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-1 bg-white/10 rounded-xl p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg touch-target transition-colors ${
                  active ? 'bg-white text-primary shadow-sm' : 'text-emerald-100 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-24 no-scrollbar">
        {(error || success) && (
          <div
            className={`mb-3 px-4 py-3 rounded-xl text-sm flex items-center gap-2 animate-fade-in ${
              error
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            }`}
          >
            {error ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            )}
            {error || success}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <>
            {tab === 'locations' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Limits: {maxShops} shop{maxShops !== 1 ? 's' : ''}, {maxWarehouses} warehouse
                    {maxWarehouses !== 1 ? 's' : ''}
                  </p>
                  {(canAddShop || canAddWarehouse) && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddLocation((v) => !v);
                        setNewLocType(canAddShop ? 'shop' : 'warehouse');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium touch-target"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  )}
                </div>

                {showAddLocation && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 animate-fade-in">
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
                      <input
                        type="text"
                        value={newLocName}
                        onChange={(e) => setNewLocName(e.target.value)}
                        placeholder={newLocType === 'warehouse' ? 'e.g. Main Warehouse' : 'e.g. Front Shop'}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 block">Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!canAddShop}
                          onClick={() => setNewLocType('shop')}
                          className={`py-2.5 rounded-xl text-sm font-medium touch-target border ${
                            newLocType === 'shop'
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-gray-600 border-gray-200'
                          } disabled:opacity-40`}
                        >
                          Shop
                        </button>
                        <button
                          type="button"
                          disabled={!canAddWarehouse}
                          onClick={() => setNewLocType('warehouse')}
                          className={`py-2.5 rounded-xl text-sm font-medium touch-target border ${
                            newLocType === 'warehouse'
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-gray-600 border-gray-200'
                          } disabled:opacity-40`}
                        >
                          Warehouse
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAddLocation()}
                      disabled={busy}
                      className="w-full py-3 bg-primary text-white rounded-xl font-bold text-sm touch-target disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Create location'}
                    </button>
                  </div>
                )}

                {locations.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">No locations yet</div>
                ) : (
                  locations.map((loc) => (
                    <div
                      key={loc.id}
                      className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex items-center gap-3"
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          loc.location_type === 'warehouse'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-primary'
                        }`}
                      >
                        {loc.location_type === 'warehouse' ? (
                          <Warehouse className="w-5 h-5" />
                        ) : (
                          <Store className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">{loc.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                              loc.location_type === 'warehouse'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {loc.location_type}
                          </span>
                          {loc.is_default === 1 && (
                            <span className="text-[10px] text-gray-400 font-medium">Default</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'receive' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Product</label>
                  <select
                    value={recvProductId}
                    onChange={(e) => setRecvProductId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {products.length === 0 && <option value="">No products</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (stock {p.stock_level})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Location</label>
                  <select
                    value={recvLocationId}
                    onChange={(e) => setRecvLocationId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.location_type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={recvQty}
                    onChange={(e) => setRecvQty(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Batch code <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={recvBatch}
                    onChange={(e) => setRecvBatch(e.target.value)}
                    placeholder="e.g. LOT-042"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                {trackExpiry && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1.5 block">Expiry date</label>
                    <input
                      type="date"
                      value={recvExpiry}
                      onChange={(e) => setRecvExpiry(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleReceive()}
                  disabled={busy || products.length === 0}
                  className="w-full py-3.5 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                >
                  <ArrowDownToLine className="w-5 h-5" />
                  {busy ? 'Receiving…' : 'Receive stock'}
                </button>
              </div>
            )}

            {tab === 'transfer' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">From</label>
                  <select
                    value={xferFromId}
                    onChange={(e) => setXferFromId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.location_type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">To</label>
                  <select
                    value={xferToId}
                    onChange={(e) => setXferToId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.location_type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Product</label>
                  <select
                    value={xferProductId}
                    onChange={(e) => setXferProductId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {products.length === 0 && <option value="">No products</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (stock {p.stock_level})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={xferQty}
                    onChange={(e) => setXferQty(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                {locations.length < 2 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Add at least two locations to transfer stock between them.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleTransfer()}
                  disabled={busy || products.length === 0 || locations.length < 2}
                  className="w-full py-3.5 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                >
                  <ArrowLeftRight className="w-5 h-5" />
                  {busy ? 'Transferring…' : 'Transfer stock'}
                </button>
              </div>
            )}

            {tab === 'expiry' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 px-0.5">
                  Batches expiring within 30 days
                </p>
                {expiring.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">No expiring batches</p>
                  </div>
                ) : (
                  expiring.map((batch) => {
                    const days = daysUntilExpiry(batch.expiry_date);
                    const product = productMap.get(batch.product_id);
                    const location = locationMap.get(batch.location_id);
                    return (
                      <div
                        key={batch.id}
                        className={`rounded-xl border px-4 py-3.5 ${urgencyClasses(days)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">
                              {product?.name || 'Unknown product'}
                            </p>
                            <p className="text-xs mt-0.5 opacity-80">
                              {location?.name || 'Unknown location'}
                              {batch.batch_code ? ` · ${batch.batch_code}` : ''}
                            </p>
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                            {urgencyLabel(days)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <span>Qty: {batch.quantity}</span>
                          <span>Exp: {batch.expiry_date?.slice(0, 10) || '—'}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

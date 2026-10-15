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
  ChevronLeft,
  History,
  SlidersHorizontal,
  Boxes,
  Search,
  FileBarChart2,
  Download,
  FileText,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerPushSync } from '@/lib/sync';
import {
  db,
  type LocalLocation,
  type LocalProduct,
  type LocalStockBatch,
  type LocalStockMovement,
} from '@/lib/dexie';
import {
  adjustLocationStock,
  createLocation,
  ensureStoreLocations,
  getExpiringBatches,
  getLocationInventory,
  getLocationStats,
  listLocationBatches,
  listLocationMovements,
  listLocations,
  receiveStock,
  transferStock,
  type LocationStats,
  type LocationStockRow,
} from '@/lib/warehouse';
import {
  buildLocationReportSummary,
  exportLocationReportCsv,
  exportLocationReportPdf,
  formatReportPeriodLabel,
  getPeriodRange,
  type LocationReportSummary,
} from '@/lib/reportAnalytics';
import FinancialDonutChart from '@/components/FinancialDonutChart';
import {
  clearWarehouseUnlock,
  getUnlockedWarehouseLocationId,
} from '@/lib/warehouseAccess';
import { orgFromStore } from '@/lib/formalPdf';

type HubMode = 'hub' | 'workspace';
type WorkspaceTab = 'stock' | 'receive' | 'transfer' | 'expiry' | 'adjust' | 'history' | 'report';
type TransferStatus = 'idle' | 'preparing' | 'moving' | 'complete';

interface WarehousePageProps {
  onBackToSettings?: () => void;
}

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; icon: typeof Warehouse }[] = [
  { id: 'stock', label: 'Stock', icon: Boxes },
  { id: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'expiry', label: 'Expiry', icon: CalendarClock },
  { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { id: 'history', label: 'History', icon: History },
  { id: 'report', label: 'Report', icon: FileBarChart2 },
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

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export default function WarehousePage({ onBackToSettings }: WarehousePageProps) {
  const { currentStore, currentUser } = useAuthStore();
  const warehouseEnabled = (currentStore?.warehouse_enabled ?? 0) === 1;
  const maxShops = currentStore?.max_shops ?? 1;
  const maxWarehouses = currentStore?.max_warehouses ?? 0;

  const [mode, setMode] = useState<HubMode>('hub');
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('stock');
  const [unlockRequired, setUnlockRequired] = useState(false);

  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [locationStats, setLocationStats] = useState<Record<string, LocationStats>>({});
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [inventory, setInventory] = useState<LocationStockRow[]>([]);
  const [batches, setBatches] = useState<LocalStockBatch[]>([]);
  const [expiring, setExpiring] = useState<LocalStockBatch[]>([]);
  const [movements, setMovements] = useState<LocalStockMovement[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [stockQuery, setStockQuery] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add shop location only (warehouses are created from Settings)
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocName, setNewLocName] = useState('');

  // Receive (scoped to active location)
  const [recvProductId, setRecvProductId] = useState('');
  const [recvQty, setRecvQty] = useState('');
  const [recvBatch, setRecvBatch] = useState('');
  const [recvExpiry, setRecvExpiry] = useState('');
  const [recvCost, setRecvCost] = useState('');

  // Transfer (from active location by default)
  const [xferDirection, setXferDirection] = useState<'out' | 'in'>('out');
  const [xferOtherId, setXferOtherId] = useState('');
  const [xferProductId, setXferProductId] = useState('');
  const [xferQty, setXferQty] = useState('');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle');

  // Adjust
  const [adjProductId, setAdjProductId] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjDirection, setAdjDirection] = useState<'in' | 'out'>('in');
  const [adjNote, setAdjNote] = useState('');

  // Location report
  const [locationReport, setLocationReport] = useState<LocationReportSummary | null>(null);
  const [reportPeriod, setReportPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [reportBusy, setReportBusy] = useState(false);

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

  const activeLocation = activeLocationId ? locationMap.get(activeLocationId) || null : null;
  const otherLocations = locations.filter((l) => l.id !== activeLocationId);

  const shopCount = locations.filter((l) => l.location_type === 'shop').length;
  const warehouseCount = locations.filter((l) => l.location_type === 'warehouse').length;
  const canAddShop = shopCount < maxShops;

  const selectedRecvProduct = productMap.get(recvProductId) || null;
  const trackExpiry = (selectedRecvProduct?.track_expiry ?? 0) === 1;

  const filteredInventory = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter(
      (row) =>
        row.product.name.toLowerCase().includes(q) ||
        row.product.barcode.toLowerCase().includes(q) ||
        row.product.category.toLowerCase().includes(q)
    );
  }, [inventory, stockQuery]);

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

  const loadHub = useCallback(async () => {
    if (!currentStore?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await ensureStoreLocations(currentStore.id);
      const locs = await listLocations(currentStore.id);
      locs.sort((a, b) => {
        if (a.location_type !== b.location_type) {
          return a.location_type === 'warehouse' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      setLocations(locs);

      const statsEntries = await Promise.all(
        locs.map(async (loc) => [loc.id, await getLocationStats(currentStore.id, loc.id)] as const)
      );
      setLocationStats(Object.fromEntries(statsEntries));

      const prods = await db.products
        .where('store_id')
        .equals(currentStore.id)
        .and((p) => p.is_active === 1)
        .toArray();
      prods.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(prods);

      if (!recvProductId && prods[0]) setRecvProductId(prods[0].id);
      if (!xferProductId && prods[0]) setXferProductId(prods[0].id);
      if (!adjProductId && prods[0]) setAdjProductId(prods[0].id);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to load warehouse data', true);
    }
    setLoading(false);
  }, [currentStore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadWorkspace = useCallback(async () => {
    if (!currentStore?.id || !activeLocationId) return;
    setLoading(true);
    try {
      const [inv, batchList, exp, movs, stats] = await Promise.all([
        getLocationInventory(currentStore.id, activeLocationId),
        listLocationBatches(currentStore.id, activeLocationId),
        getExpiringBatches(currentStore.id, 30, activeLocationId),
        listLocationMovements(currentStore.id, activeLocationId),
        getLocationStats(currentStore.id, activeLocationId),
      ]);
      setInventory(inv);
      setBatches(batchList);
      setExpiring(exp);
      setMovements(movs);
      setLocationStats((prev) => ({ ...prev, [activeLocationId]: stats }));

      if (otherLocations.length > 0) {
        setXferOtherId((prev) =>
          prev && otherLocations.some((l) => l.id === prev) ? prev : otherLocations[0].id
        );
      }
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to load location data', true);
    }
    setLoading(false);
  }, [currentStore?.id, activeLocationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void (async () => {
      await loadHub();
      if (!currentStore?.id) return;
    const unlockedId = getUnlockedWarehouseLocationId(currentStore.id);
    if (unlockedId) {
      setUnlockRequired(false);
      setActiveLocationId(unlockedId);
      setTab('stock');
      setMode('workspace');
      setExpandedProductId(null);
      setStockQuery('');
    } else {
      // Store-to-store transfers are available from the owner account even when
      // the optional warehouse module is disabled. Warehouse locations still
      // require their existing warehouse PIN unlock flow.
      setUnlockRequired(false);
      setMode('hub');
      setActiveLocationId(null);
    }
    })();
  }, [loadHub, currentStore?.id]);

  useEffect(() => {
    if (mode === 'workspace' && activeLocationId) {
      void loadWorkspace();
    }
  }, [mode, activeLocationId, loadWorkspace]);

  const loadLocationReport = useCallback(async () => {
    if (!currentStore?.id || !activeLocationId) {
      setLocationReport(null);
      return;
    }
    setReportBusy(true);
    try {
      const range = reportPeriod === 'all' ? null : getPeriodRange(reportPeriod);
      const label =
        reportPeriod === 'all' ? 'All time' : formatReportPeriodLabel(reportPeriod);
      const report = await buildLocationReportSummary(
        currentStore.id,
        activeLocationId,
        range,
        currentStore.name,
        label,
        reportPeriod
      );
      setLocationReport(report);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to build location report', true);
      setLocationReport(null);
    }
    setReportBusy(false);
  }, [currentStore?.id, currentStore?.name, activeLocationId, reportPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === 'workspace' && tab === 'report' && activeLocationId) {
      void loadLocationReport();
    }
  }, [mode, tab, activeLocationId, loadLocationReport]);

  const openLocation = (locationId: string) => {
    setUnlockRequired(false);
    setActiveLocationId(locationId);
    setTab('stock');
    setMode('workspace');
    setExpandedProductId(null);
    setStockQuery('');
  };

  const backToHub = () => {
    clearWarehouseUnlock();
    setMode('hub');
    setActiveLocationId(null);
    setTab('stock');
    setUnlockRequired(true);
    void loadHub();
    onBackToSettings?.();
  };

  const handleAddLocation = async () => {
    if (!currentStore?.id) return;
    if (!canAddShop) {
      flash('Shop location limit reached', true);
      return;
    }

    setBusy(true);
    try {
      const created = await createLocation({
        storeId: currentStore.id,
        name: newLocName.trim() || 'Shop',
        locationType: 'shop',
      });
      setNewLocName('');
      setShowAddLocation(false);
      flash('Shop added');
      await loadHub();
      openLocation(created.id);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to add location', true);
    }
    setBusy(false);
  };

  const handleReceive = async () => {
    if (!currentStore?.id || !activeLocationId) return;
    const qty = parseInt(recvQty, 10);
    if (!recvProductId) {
      flash('Select a product', true);
      return;
    }
    if (!qty || qty <= 0) {
      flash('Enter a valid quantity', true);
      return;
    }
    setBusy(true);
    try {
      const cost = recvCost.trim() ? Number(recvCost) : undefined;
      await receiveStock({
        storeId: currentStore.id,
        productId: recvProductId,
        locationId: activeLocationId,
        quantity: qty,
        batchCode: recvBatch.trim() || undefined,
        expiryDate: trackExpiry && recvExpiry ? recvExpiry : null,
        costPrice: Number.isFinite(cost) ? cost : undefined,
        userId: currentUser?.id || null,
        note: `Received at ${activeLocation?.name || 'location'}`,
      });
      setRecvQty('');
      setRecvBatch('');
      setRecvExpiry('');
      setRecvCost('');
      flash(`Received ${qty} into ${activeLocation?.name || 'location'}`);
      await loadWorkspace();
      void triggerPushSync('warehouse-receive');
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Receive failed', true);
    }
    setBusy(false);
  };

  const handleTransfer = async () => {
    if (!currentStore?.id || !activeLocationId) return;
    const qty = parseInt(xferQty, 10);
    if (!xferProductId) {
      flash('Select a product', true);
      return;
    }
    if (!xferOtherId) {
      flash('Select the other location', true);
      return;
    }
    if (!qty || qty <= 0) {
      flash('Enter a valid quantity', true);
      return;
    }

    const fromLocationId = xferDirection === 'out' ? activeLocationId : xferOtherId;
    const toLocationId = xferDirection === 'out' ? xferOtherId : activeLocationId;

    setBusy(true);
    setTransferStatus('preparing');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setTransferStatus('moving');
      await transferStock({
        storeId: currentStore.id,
        productId: xferProductId,
        fromLocationId,
        toLocationId,
        quantity: qty,
        userId: currentUser?.id || null,
        note:
          xferDirection === 'out'
            ? `Transfer out from ${activeLocation?.name || 'location'}`
            : `Transfer in to ${activeLocation?.name || 'location'}`,
      });
      setXferQty('');
      setTransferStatus('complete');
      flash(`Transferred ${qty} units`);
      await loadWorkspace();
      void triggerPushSync('warehouse-transfer');
      window.setTimeout(() => setTransferStatus('idle'), 2200);
    } catch (err: unknown) {
      setTransferStatus('idle');
      flash(err instanceof Error ? err.message : 'Transfer failed', true);
    }
    setBusy(false);
  };

  const handleAdjust = async () => {
    if (!currentStore?.id || !activeLocationId) return;
    const qty = parseInt(adjQty, 10);
    if (!adjProductId) {
      flash('Select a product', true);
      return;
    }
    if (!qty || qty <= 0) {
      flash('Enter a valid quantity', true);
      return;
    }
    if (!adjNote.trim()) {
      flash('Enter a reason so this adjustment is recorded in the stock audit.', true);
      return;
    }

    setBusy(true);
    try {
      await adjustLocationStock({
        storeId: currentStore.id,
        productId: adjProductId,
        locationId: activeLocationId,
        delta: adjDirection === 'in' ? qty : -qty,
        note: adjNote.trim(),
        userId: currentUser?.id || null,
      });
      setAdjQty('');
      setAdjNote('');
      flash(
        adjDirection === 'in'
          ? `Added ${qty} at ${activeLocation?.name || 'location'}`
          : `Removed ${qty} from ${activeLocation?.name || 'location'}`
      );
      await loadWorkspace();
      void triggerPushSync('warehouse-adjust');
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Adjustment failed', true);
    }
    setBusy(false);
  };

  if (unlockRequired && mode === 'hub') {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div className="flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-white" />
            <h1 className="text-white font-bold text-lg">Warehouse</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 pb-8">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <Warehouse className="w-8 h-8 text-amber-700" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Unlock with warehouse PIN</h2>
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              Switching to a warehouse works like switching stores — sign out from Settings → My
              Warehouses (or pick the warehouse on the login screen), then enter that warehouse&apos;s
              PIN.
            </p>
            <p className="text-[11px] text-gray-400 mb-4">
              {warehouseCount} warehouse{warehouseCount !== 1 ? 's' : ''} · limit {maxWarehouses}
            </p>
            {onBackToSettings && (
              <button
                type="button"
                onClick={onBackToSettings}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white touch-target"
              >
                Go to store login
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeStats = activeLocationId ? locationStats[activeLocationId] : null;

  return (
    <div className="page-shell">
      <div className="page-header">
        {mode === 'hub' ? (
          <div className="mb-1">
            <div className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-white" />
              <h1 className="text-white font-bold text-lg">Branch inventory</h1>
            </div>
            <p className="text-emerald-200 text-[11px] mt-1 leading-snug">
              Select any store or warehouse attached to this owner account to manage stock, receiving,
              transfers, expiry, adjustments, and history.
            </p>
            <p className="text-emerald-100/80 text-[10px] mt-1.5">
              {shopCount} shop{shopCount !== 1 ? 's' : ''} · {warehouseCount} warehouse
              {warehouseCount !== 1 ? 's' : ''} · limits {maxShops}/{maxWarehouses}
            </p>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={backToHub}
              className="inline-flex items-center gap-1 text-emerald-100 text-xs font-medium mb-2 touch-target"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to store login
            </button>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {activeLocation?.location_type === 'warehouse' ? (
                    <Warehouse className="w-5 h-5 text-white flex-shrink-0" />
                  ) : (
                    <Store className="w-5 h-5 text-white flex-shrink-0" />
                  )}
                  <h1 className="text-white font-bold text-lg truncate">
                    {activeLocation?.name || 'Location'}
                  </h1>
                </div>
                <p className="text-emerald-200 text-[10px] mt-0.5 capitalize">
                  {activeLocation?.location_type || 'location'} workspace
                  {activeStats
                    ? ` · ${activeStats.skuCount} SKUs · ${activeStats.totalUnits} units`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex gap-1 bg-white/10 rounded-xl p-1 overflow-x-auto no-scrollbar">
              {WORKSPACE_TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex-1 min-w-[4.5rem] flex flex-col items-center gap-0.5 py-2 rounded-lg touch-target transition-colors ${
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
        )}
      </div>

      <div className="page-body no-scrollbar">
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
        ) : mode === 'hub' ? (
          <div className="space-y-3 md:max-w-3xl md:mx-auto xl:max-w-none xl:mx-0">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs text-emerald-900 leading-relaxed">
              Create and unlock warehouses from <span className="font-semibold">Settings → My Warehouses</span>.
              You can still add extra shop locations here if your admin raised the shop limit.
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                Branches attached to {currentStore?.name || 'your account'}
              </p>
              {canAddShop && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddLocation((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium touch-target"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add shop
                </button>
              )}
            </div>

            {showAddLocation && (
              <div className="bg-white border border-emerald-100 rounded-xl p-4 space-y-3 animate-fade-in">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Shop name</label>
                  <input
                    type="text"
                    value={newLocName}
                    onChange={(e) => setNewLocName(e.target.value)}
                    placeholder="e.g. Front Shop"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleAddLocation()}
                  disabled={busy}
                  className="w-full py-3 bg-primary text-white rounded-xl font-bold text-sm touch-target disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Create shop'}
                </button>
              </div>
            )}

            {locations.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No locations yet</div>
            ) : (
              <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 xl:grid-cols-3 2xl:grid-cols-4">
                {locations.map((loc) => {
                  const stats = locationStats[loc.id];
                  return (
                    <div
                      key={loc.id}
                      className="bg-white border border-emerald-100 rounded-xl px-4 py-3.5 flex items-center gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => openLocation(loc.id)}
                        className="flex-1 min-w-0 text-left flex items-center gap-3 touch-target"
                      >
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            loc.location_type === 'warehouse'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-emerald-50 text-primary'
                          }`}
                        >
                          {loc.location_type === 'warehouse' ? (
                            <Warehouse className="w-6 h-6" />
                          ) : (
                            <Store className="w-6 h-6" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{loc.name}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                          <p className="text-[11px] text-gray-500 mt-1.5">
                            {stats
                              ? `${stats.skuCount} SKUs · ${stats.totalUnits} units${
                                  stats.expiringSoon > 0 ? ` · ${stats.expiringSoon} expiring` : ''
                                }`
                              : 'Tap to manage'}
                          </p>
                        </div>
                      </button>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => openLocation(loc.id)}
                          className="text-primary text-xs font-semibold px-2 py-1"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          title="Export CSV report"
                          onClick={async () => {
                            if (!currentStore?.id) return;
                            try {
                              const report = await buildLocationReportSummary(
                                currentStore.id,
                                loc.id,
                                getPeriodRange('month'),
                                currentStore.name,
                                'This Month',
                                'month'
                              );
                              exportLocationReportCsv(report);
                            } catch (err: unknown) {
                              flash(err instanceof Error ? err.message : 'Export failed', true);
                            }
                          }}
                          className="p-1.5 rounded-lg bg-emerald-50 text-primary touch-target"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            {tab === 'stock' && (
              <div className="space-y-3 md:max-w-3xl md:mx-auto xl:max-w-none xl:mx-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={stockQuery}
                    onChange={(e) => setStockQuery(e.target.value)}
                    placeholder="Search stock at this location…"
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-emerald-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {filteredInventory.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 font-medium">No stock at this location</p>
                    <p className="text-xs text-gray-400 mt-1 mb-4">Receive or transfer stock in to begin</p>
                    <button
                      type="button"
                      onClick={() => setTab('receive')}
                      className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold touch-target"
                    >
                      Receive stock
                    </button>
                  </div>
                ) : (
                  filteredInventory.map((row) => {
                    const open = expandedProductId === row.product.id;
                    const productBatches = batches.filter((b) => b.product_id === row.product.id);
                    return (
                      <div
                        key={row.product.id}
                        className="bg-white border border-emerald-50 rounded-xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProductId((id) => (id === row.product.id ? null : row.product.id))
                          }
                          className="w-full px-4 py-3 flex items-center gap-3 text-left touch-target"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {row.product.name}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {row.batchCount} batch{row.batchCount !== 1 ? 'es' : ''}
                              {row.product.track_expiry === 1 ? ' · Expiry tracked' : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-primary">{row.quantity}</p>
                            <p className="text-[10px] text-gray-400">units here</p>
                          </div>
                        </button>
                        {open && (
                          <div className="border-t border-emerald-50 px-4 py-3 bg-[var(--color-surface)] space-y-2">
                            {productBatches.length === 0 ? (
                              <p className="text-xs text-gray-400">No open batches</p>
                            ) : (
                              productBatches.map((batch) => {
                                const days = daysUntilExpiry(batch.expiry_date);
                                return (
                                  <div
                                    key={batch.id}
                                    className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-gray-100"
                                  >
                                    <div className="min-w-0">
                                      <p className="font-medium text-gray-800 truncate">
                                        {batch.batch_code || 'No batch code'}
                                      </p>
                                      <p className="text-gray-500 mt-0.5">
                                        Exp: {batch.expiry_date?.slice(0, 10) || '—'}
                                        {days != null ? ` · ${urgencyLabel(days)}` : ''}
                                      </p>
                                    </div>
                                    <span className="font-bold text-gray-900">{batch.quantity}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === 'receive' && (
              <div className="bg-white border border-emerald-100 rounded-xl p-4 space-y-4 md:max-w-xl md:mx-auto">
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  Receiving into <span className="font-semibold">{activeLocation?.name}</span> only.
                </p>
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
                        {p.name}
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
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Cost / unit <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={recvCost}
                    onChange={(e) => setRecvCost(e.target.value)}
                    placeholder="0.00"
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
                  {busy ? 'Receiving…' : 'Receive stock here'}
                </button>
              </div>
            )}

            {tab === 'transfer' && (
              <div className="bg-white border border-emerald-100 rounded-xl p-4 space-y-4 md:max-w-xl md:mx-auto">
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  Working in <span className="font-semibold">{activeLocation?.name}</span>. Choose whether
                  stock leaves or arrives at this location.
                </p>
                {transferStatus !== 'idle' && (
                  <div
                    className={`rounded-2xl border px-4 py-4 transition-all duration-500 ${
                      transferStatus === 'complete'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-primary/20 bg-primary/[0.04]'
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
                        {transferStatus === 'complete' ? (
                          <CheckCircle2 className="h-6 w-6 text-emerald-600 animate-fade-in" />
                        ) : (
                          <>
                            <span className="absolute inset-0 rounded-full border-2 border-primary/20" />
                            <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
                            <ArrowLeftRight className="h-4 w-4 text-primary animate-pulse" />
                          </>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900">
                          {transferStatus === 'preparing' ? 'Preparing transfer' : transferStatus === 'moving' ? 'Moving stock securely' : 'Transfer complete'}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {transferStatus === 'complete'
                            ? 'Both branch inventories have been updated.'
                            : 'Updating the source and destination branch records…'}
                        </p>
                      </div>
                      {transferStatus !== 'complete' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/80">
                      <div className={`h-full rounded-full bg-primary transition-all duration-700 ${transferStatus === 'preparing' ? 'w-1/3' : 'w-4/5'}`} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setXferDirection('out')}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target border ${
                      xferDirection === 'out'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    Transfer out
                  </button>
                  <button
                    type="button"
                    onClick={() => setXferDirection('in')}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target border ${
                      xferDirection === 'in'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    Transfer in
                  </button>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    {xferDirection === 'out' ? 'To location' : 'From location'}
                  </label>
                  <select
                    value={xferOtherId}
                    onChange={(e) => setXferOtherId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {otherLocations.length === 0 && <option value="">No other locations</option>}
                    {otherLocations.map((l) => (
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
                        {p.name}
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
                {otherLocations.length === 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Add another location from the hub to transfer stock.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleTransfer()}
                  disabled={busy || products.length === 0 || otherLocations.length === 0}
                  className="w-full py-3.5 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                >
                  <ArrowLeftRight className="w-5 h-5" />
                  {busy ? 'Transferring…' : xferDirection === 'out' ? 'Send stock out' : 'Bring stock in'}
                </button>
              </div>
            )}

            {tab === 'expiry' && (
              <div className="space-y-3 md:max-w-3xl md:mx-auto xl:max-w-none xl:mx-0">
                <p className="text-xs text-gray-500 px-0.5">
                  Batches at {activeLocation?.name} expiring within 30 days
                </p>
                {expiring.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">No expiring batches here</p>
                  </div>
                ) : (
                  expiring.map((batch) => {
                    const days = daysUntilExpiry(batch.expiry_date);
                    const product = productMap.get(batch.product_id);
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
                              {batch.batch_code ? batch.batch_code : 'No batch code'}
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

            {tab === 'adjust' && (
              <div className="bg-white border border-emerald-100 rounded-xl p-4 space-y-4 md:max-w-xl md:mx-auto">
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  Adjustments apply only to <span className="font-semibold">{activeLocation?.name}</span>.
                  Removals use FEFO batch order.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjDirection('in')}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target border ${
                      adjDirection === 'in'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    Add stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjDirection('out')}
                    className={`py-2.5 rounded-xl text-sm font-semibold touch-target border ${
                      adjDirection === 'out'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    Remove stock
                  </button>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Product</label>
                  <select
                    value={adjProductId}
                    onChange={(e) => setAdjProductId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
                  >
                    {products.length === 0 && <option value="">No products</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={adjQty}
                    onChange={(e) => setAdjQty(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    Reason *
                  </label>
                  <input
                    type="text"
                    value={adjNote}
                    onChange={(e) => setAdjNote(e.target.value)}
                    placeholder="e.g. Count correction, damaged goods"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleAdjust()}
                  disabled={busy || products.length === 0}
                  className={`w-full py-3.5 text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50 ${
                    adjDirection === 'in' ? 'bg-primary' : 'bg-amber-600'
                  }`}
                >
                  <SlidersHorizontal className="w-5 h-5" />
                  {busy ? 'Saving…' : adjDirection === 'in' ? 'Add adjustment' : 'Remove adjustment'}
                </button>
              </div>
            )}

            {tab === 'history' && (
              <div className="space-y-2 md:max-w-3xl md:mx-auto xl:max-w-none xl:mx-0">
                <p className="text-xs text-gray-500 px-0.5">
                  Recent movements for {activeLocation?.name}
                </p>
                {movements.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">No movements yet</p>
                  </div>
                ) : (
                  movements.map((m) => {
                    const product = productMap.get(m.product_id);
                    const from = m.from_location_id
                      ? locationMap.get(m.from_location_id)?.name
                      : null;
                    const to = m.to_location_id ? locationMap.get(m.to_location_id)?.name : null;
                    const label =
                      m.movement_type === 'receive'
                        ? 'Received'
                        : m.movement_type === 'transfer'
                          ? 'Transfer'
                          : m.movement_type === 'sale'
                            ? 'Sale'
                            : 'Adjustment';
                    return (
                      <div
                        key={m.id}
                        className="bg-white border border-emerald-50 rounded-xl px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {product?.name || 'Product'}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {label}
                              {from || to
                                ? ` · ${from || '—'} → ${to || '—'}`
                                : ''}
                              {m.note ? ` · ${m.note}` : ''}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold text-gray-900">{m.quantity}</p>
                            <p className="text-[10px] text-gray-400">{formatWhen(m.created_at)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === 'report' && (
              <div className="space-y-3 md:max-w-xl md:mx-auto">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    Individual report for {activeLocation?.name}
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={!locationReport || reportBusy}
                      onClick={() => locationReport && exportLocationReportCsv(locationReport)}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-emerald-50 text-primary text-xs font-semibold touch-target disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </button>
                    <button
                      type="button"
                      disabled={!locationReport || reportBusy}
                      onClick={() =>
                        locationReport &&
                        exportLocationReportPdf(locationReport, orgFromStore(currentStore))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold touch-target disabled:opacity-40"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      PDF
                    </button>
                  </div>
                </div>

                <div className="flex gap-1 bg-white border border-emerald-50 rounded-xl p-1">
                  {([
                    { key: 'today', label: 'Today' },
                    { key: 'week', label: 'Week' },
                    { key: 'month', label: 'Month' },
                    { key: 'all', label: 'All' },
                  ] as const).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setReportPeriod(p.key)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold touch-target ${
                        reportPeriod === p.key
                          ? 'bg-primary text-white'
                          : 'text-gray-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {reportBusy || !locationReport ? (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    <span className="text-sm">Building report…</span>
                  </div>
                ) : (
                  <>
                    <FinancialDonutChart
                      title={`Sales · ${locationReport.periodLabel}`}
                      metrics={{
                        costPrice: locationReport.costPrice,
                        sellingPrice: locationReport.sellingPrice,
                        profitEstimate: locationReport.profitEstimate,
                      }}
                    />

                    <FinancialDonutChart
                      title="Stock on hand valuation"
                      metrics={{
                        costPrice: locationReport.stockCostValue,
                        sellingPrice: locationReport.stockSellingValue,
                        profitEstimate: locationReport.stockProfitEstimate,
                      }}
                    />

                    <div className="bg-white border border-emerald-50 rounded-xl p-4 text-sm space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Transactions</span>
                        <span className="font-semibold">{locationReport.transactionCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Stock SKUs</span>
                        <span className="font-semibold">{locationReport.stockSkuCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Stock units</span>
                        <span className="font-semibold">{locationReport.stockUnits}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

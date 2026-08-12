import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Users, Package, Wallet, RefreshCcw, LogOut, ChevronLeft, ChevronRight,
  Smartphone, CheckCircle2, AlertCircle, Loader2, Store, CreditCard, CalendarClock, Mail
} from 'lucide-react';
import {
  AdminDashboardData,
  StorePerformance,
  StoreSubscriptionUsage,
  formatGhs,
  getWeekEnd,
  getWeekStart,
  grantStoreSubscription,
  loadAdminDashboard,
  markWeeklyPayoutSent,
  shiftWeek,
  updateStoreEcommerce,
  updateStoreWarehouseLimits,
  buildLinkedUserStores,
} from '@/lib/adminPortal';
import { clearAdminSession } from '@/lib/adminAuth';
import {
  formatSubscriptionDate,
  subscriptionStatusLabel,
} from '@/lib/subscription';
import {
  loadPlatformSettings,
  savePlatformSettings,
  type PlatformSettings,
} from '@/lib/platformSettings';
import AdminStoreWorkspace from '@/components/AdminStoreWorkspace';

type Tab = 'overview' | 'stores' | 'users' | 'products' | 'payouts' | 'subscriptions' | 'contact';

interface AdminDashboardPageProps {
  onLogout: () => void;
}

export default function AdminDashboardPage({ onLogout }: AdminDashboardPageProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyStoreId, setBusyStoreId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [grantMonths, setGrantMonths] = useState<Record<string, number>>({});
  const [warehouseDrafts, setWarehouseDrafts] = useState<
    Record<string, { warehouse_enabled: boolean; max_shops: number; max_warehouses: number }>
  >({});
  const [ecommerceDrafts, setEcommerceDrafts] = useState<
    Record<string, { ecommerce_enabled: boolean; ecommerce_slug: string }>
  >({});
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [mnotifyApiKey, setMnotifyApiKey] = useState('');
  const [mnotifySenderId, setMnotifySenderId] = useState('Adimat');
  const [savingContact, setSavingContact] = useState(false);

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const dashboard = await loadAdminDashboard(weekStart);
      setData(dashboard);
      setWarehouseDrafts(
        Object.fromEntries(
          dashboard.stores.map((store) => [
            store.id,
            {
              warehouse_enabled: store.warehouse_enabled,
              max_shops: store.max_shops,
              max_warehouses: store.max_warehouses,
            },
          ])
        )
      );
      setEcommerceDrafts(
        Object.fromEntries(
          dashboard.stores.map((store) => [
            store.id,
            {
              ecommerce_enabled: store.ecommerce_enabled,
              ecommerce_slug: store.ecommerce_slug || '',
            },
          ])
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setData(null);
    }
    setLoading(false);
  }, [weekStart]);

  const refreshPlatformSettings = useCallback(async () => {
    const settings = await loadPlatformSettings(true);
    setPlatformSettings(settings);
    setContactWhatsapp(settings.contact_whatsapp);
    setContactEmail(settings.contact_email);
    setAdminPhone(settings.admin_phone || '');
    setMnotifyApiKey(settings.mnotify_api_key);
    setMnotifySenderId(settings.mnotify_sender_id || 'Adimat');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'contact') {
      void refreshPlatformSettings();
    }
  }, [tab, refreshPlatformSettings]);

  const handleLogout = () => {
    clearAdminSession();
    onLogout();
  };

  const handleMarkPaid = async (row: StorePerformance) => {
    if (row.weekPaystack <= 0) return;
    if (!row.store.momo_number || !row.store.momo_account_name) {
      setStatusMsg(`Add MoMo details for ${row.store.name} before marking paid (store owner Settings).`);
      return;
    }
    if (!confirm(`Mark GH₵${row.weekPaystack.toFixed(2)} as sent to ${row.store.momo_account_name} (${row.store.momo_number})?`)) {
      return;
    }

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await markWeeklyPayoutSent(row.store, weekStart, row.weekPaystack);
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to mark payout');
    } else {
      setStatusMsg(`Marked payout sent for ${row.store.name}`);
      await refresh();
    }
    setBusyStoreId(null);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const handleSaveContact = async () => {
    setSavingContact(true);
    setStatusMsg('');
    const result = await savePlatformSettings({
      contact_whatsapp: contactWhatsapp,
      contact_email: contactEmail,
      admin_phone: adminPhone,
      mnotify_api_key: mnotifyApiKey,
      mnotify_sender_id: mnotifySenderId,
    });
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to save contact settings');
    } else {
      setPlatformSettings(result.settings || null);
      setStatusMsg('Admin contact & SMS settings saved. Store Plan screens will use these details.');
    }
    setSavingContact(false);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const getWarehouseDraft = (storeId: string, fallback?: {
    warehouse_enabled: boolean;
    max_shops: number;
    max_warehouses: number;
  }) =>
    warehouseDrafts[storeId] ||
    fallback || {
      warehouse_enabled: false,
      max_shops: 1,
      max_warehouses: 0,
    };

  const handleSaveWarehouseLimits = async (row: StoreSubscriptionUsage) => {
    const draft = getWarehouseDraft(row.store.id, {
      warehouse_enabled: row.store.warehouse_enabled,
      max_shops: row.store.max_shops,
      max_warehouses: row.store.max_warehouses,
    });
    const maxShops = Math.max(1, Math.floor(Number(draft.max_shops) || 1));
    const maxWarehouses = Math.max(0, Math.floor(Number(draft.max_warehouses) || 0));

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await updateStoreWarehouseLimits(row.store.id, {
      warehouse_enabled: draft.warehouse_enabled,
      max_shops: maxShops,
      max_warehouses: maxWarehouses,
    });
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to save warehouse limits');
    } else {
      setStatusMsg(
        `Updated warehouse limits for ${row.store.name}: ${
          draft.warehouse_enabled ? 'enabled' : 'disabled'
        }, ${maxShops} shop${maxShops === 1 ? '' : 's'}, ${maxWarehouses} warehouse${
          maxWarehouses === 1 ? '' : 's'
        }`
      );
      await refresh();
    }
    setBusyStoreId(null);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const getEcommerceDraft = (
    storeId: string,
    fallback?: { ecommerce_enabled: boolean; ecommerce_slug: string }
  ) =>
    ecommerceDrafts[storeId] ||
    fallback || {
      ecommerce_enabled: false,
      ecommerce_slug: '',
    };

  const handleSaveEcommerce = async (row: StoreSubscriptionUsage) => {
    const draft = getEcommerceDraft(row.store.id, {
      ecommerce_enabled: row.store.ecommerce_enabled,
      ecommerce_slug: row.store.ecommerce_slug || '',
    });

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await updateStoreEcommerce(row.store.id, {
      ecommerce_enabled: draft.ecommerce_enabled,
      ecommerce_slug: draft.ecommerce_slug,
    });
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to save e-commerce settings');
    } else {
      setStatusMsg(
        `E-commerce for ${row.store.name}: ${
          draft.ecommerce_enabled ? `enabled (#/shop/${result.slug || draft.ecommerce_slug})` : 'disabled'
        }`
      );
      await refresh();
    }
    setBusyStoreId(null);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const handleGrantSubscription = async (row: StoreSubscriptionUsage) => {
    const months = grantMonths[row.store.id] || 1;
    if (!confirm(`Grant ${months} month${months === 1 ? '' : 's'} subscription to ${row.store.name}?`)) {
      return;
    }

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await grantStoreSubscription(row.store, months);
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to grant subscription');
    } else {
      const expiry = result.expiresAt ? formatSubscriptionDate(result.expiresAt) : '';
      setStatusMsg(
        result.error
          ? result.error
          : `Granted ${months} month${months === 1 ? '' : 's'} to ${row.store.name}${expiry ? ` (expires ${expiry})` : ''}`
      );
      await refresh();
    }
    setBusyStoreId(null);
    setTimeout(() => setStatusMsg(''), 6000);
  };

  const storeName = (storeId: string) =>
    data?.stores.find((s) => s.id === storeId)?.name || 'Unknown store';

  const linkedAccounts = useMemo(
    () => (data ? buildLinkedUserStores(data.users, data.stores) : []),
    [data]
  );

  const tabs = (
    [
      ['overview', 'Overview'],
      ['stores', 'Stores'],
      ['users', 'Users'],
      ['subscriptions', 'Subs'],
      ['payouts', 'Payouts'],
      ['products', 'Products'],
      ['contact', 'Contact'],
    ] as const
  );

  return (
    <div className="h-dvh bg-[var(--color-surface)] flex flex-col overflow-hidden md:max-w-6xl md:mx-auto md:border-x md:border-emerald-100 md:shadow-xl">
      <header className="bg-primary text-white px-3 sm:px-4 md:px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-emerald-200 text-[10px] font-semibold uppercase tracking-wide">Adimat Admin</p>
            <h1 className="text-base sm:text-lg md:text-xl font-bold truncate">Platform Overview</h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => void refresh()}
              className="p-2.5 rounded-xl bg-white/10 touch-target"
              title="Refresh"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-white/10 touch-target"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(tab === 'overview' || tab === 'payouts') && (
          <div className="mt-3 flex items-center justify-between bg-white/10 rounded-xl px-1.5 py-1.5">
            <button
              onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
              className="p-2.5 touch-target"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center min-w-0 px-1">
              <p className="text-[10px] text-emerald-100/80 uppercase">Payout week</p>
              <p className="text-xs sm:text-sm font-semibold truncate">{weekStart} → {weekEnd}</p>
            </div>
            <button
              onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
              className="p-2.5 touch-target"
              disabled={weekStart >= getWeekStart()}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Desktop / tablet top tabs */}
      <nav className="hidden sm:flex bg-white border-b border-emerald-100 px-2 md:px-4 py-2 gap-1 overflow-x-auto no-scrollbar flex-shrink-0">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id !== 'stores') setSelectedStoreId(null);
            }}
            className={`px-3 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap touch-target ${
              tab === id ? 'bg-primary text-white' : 'text-slate-600 bg-emerald-50/70'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-6 py-3 md:py-5 pb-24 sm:pb-8"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading && !data && tab !== 'contact' && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading cloud data…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-3">
            {error}
            {(error.includes('momo_') || error.includes('payouts') || error.includes('subscription') || error.includes('platform_settings') || error.includes('column')) && (
              <p className="text-xs mt-2">
                Run <code>supabase-migrate-admin.sql</code> / <code>supabase-migrate-subscriptions.sql</code> /{' '}
                <code>supabase-migrate-platform-settings.sql</code> (or the latest <code>supabase-init.sql</code>) in your Supabase SQL Editor.
              </p>
            )}
          </div>
        )}

        {statusMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-xs mb-3">
            {statusMsg}
          </div>
        )}

        {data && tab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <StatCard icon={<Building2 className="w-4 h-4" />} label="Stores" value={String(data.totals.stores)} />
              <StatCard icon={<Users className="w-4 h-4" />} label="Users" value={String(data.totals.users)} />
              <StatCard icon={<Package className="w-4 h-4" />} label="Products" value={String(data.totals.products)} />
              <StatCard icon={<Wallet className="w-4 h-4" />} label="All-time sales" value={String(data.totals.sales)} />
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 font-medium">All-time revenue</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formatGhs(data.totals.revenue)}</p>
              <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                <div>
                  <p className="text-[11px] text-slate-500">Paystack (online)</p>
                  <p className="font-semibold text-emerald-700">{formatGhs(data.totals.paystack)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">This week Paystack</p>
                  <p className="font-semibold text-amber-700">{formatGhs(data.totals.weekPaystack)}</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                {data.totals.pendingPayouts} store{data.totals.pendingPayouts === 1 ? '' : 's'} awaiting weekly remittance
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock className="w-4 h-4 text-slate-400" />
                <p className="text-xs text-slate-500 font-medium">Subscriptions</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-slate-500">Active</p>
                  <p className="font-semibold text-emerald-700">{data.totals.subsActive}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Expiring ≤7 days</p>
                  <p className="font-semibold text-amber-700">{data.totals.subsExpiringSoon}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Expired</p>
                  <p className="font-semibold text-red-700">{data.totals.subsExpired}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">No subscription</p>
                  <p className="font-semibold text-slate-700">{data.totals.subsNone}</p>
                </div>
              </div>
            </div>

            <h2 className="text-sm font-bold text-slate-800 pt-1">Stores by weekly Paystack</h2>
            {data.performance.slice(0, 8).map((row) => (
              <StoreRevenueCard key={row.store.id} row={row} compact />
            ))}
          </div>
        )}

        {data && tab === 'subscriptions' && (
          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
              Grant monthly access to each store owner. When a subscription is within 7 days of expiry
              (or already expired), the store app shows a warning to contact the system administrator to renew.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Active" value={String(data.totals.subsActive)} />
              <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Expiring soon" value={String(data.totals.subsExpiringSoon)} />
              <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Expired" value={String(data.totals.subsExpired)} />
              <StatCard icon={<CalendarClock className="w-4 h-4" />} label="No subscription" value={String(data.totals.subsNone)} />
            </div>

            {data.subscriptions.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-10">No stores synced to the cloud yet.</p>
            )}

            {data.subscriptions.map((row) => {
              const months = grantMonths[row.store.id] || 1;
              const warehouseDraft = getWarehouseDraft(row.store.id, {
                warehouse_enabled: row.store.warehouse_enabled,
                max_shops: row.store.max_shops,
                max_warehouses: row.store.max_warehouses,
              });
              const ecommerceDraft = getEcommerceDraft(row.store.id, {
                ecommerce_enabled: row.store.ecommerce_enabled,
                ecommerce_slug: row.store.ecommerce_slug || '',
              });
              const statusColor =
                row.status === 'active'
                  ? row.isExpiringSoon
                    ? 'text-amber-700 bg-amber-50'
                    : 'text-emerald-700 bg-emerald-50'
                  : row.status === 'expired'
                    ? 'text-red-700 bg-red-50'
                    : 'text-slate-600 bg-slate-100';

              return (
                <div key={row.store.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{row.store.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.userCount} users · {row.productCount} products
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Warehouse {row.store.warehouse_enabled ? 'on' : 'off'} ·{' '}
                        {row.store.max_shops} shop{row.store.max_shops === 1 ? '' : 's'} ·{' '}
                        {row.store.max_warehouses} warehouse
                        {row.store.max_warehouses === 1 ? '' : 's'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        E-commerce {row.store.ecommerce_enabled ? 'on' : 'off'}
                        {row.store.ecommerce_slug ? ` · #/shop/${row.store.ecommerce_slug}` : ''}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg ${statusColor}`}>
                      {subscriptionStatusLabel(row.status)}
                      {row.isExpiringSoon ? ' · soon' : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Expires</p>
                      <p className="font-semibold text-slate-900">
                        {formatSubscriptionDate(row.store.subscription_expires_at)}
                        {row.daysLeft != null && row.status === 'active' ? ` (${row.daysLeft}d)` : ''}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Months granted</p>
                      <p className="font-semibold text-slate-900">{row.monthsGranted}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Period usage</p>
                      <p className="font-semibold text-slate-900">
                        {row.periodSales} sale{row.periodSales === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Period revenue</p>
                      <p className="font-semibold text-slate-900">{formatGhs(row.periodRevenue)}</p>
                    </div>
                  </div>

                  {row.lastGrantedAt && (
                    <p className="text-[11px] text-slate-500 mt-2">
                      Last grant: {formatSubscriptionDate(row.lastGrantedAt)} · {row.grantCount} grant{row.grantCount === 1 ? '' : 's'}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-[11px] text-slate-500 whitespace-nowrap">Months</label>
                    <select
                      value={months}
                      onChange={(e) =>
                        setGrantMonths((prev) => ({
                          ...prev,
                          [row.store.id]: Number(e.target.value),
                        }))
                      }
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm"
                    >
                      {[1, 2, 3, 6, 12].map((m) => (
                        <option key={m} value={m}>
                          {m} month{m === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void handleGrantSubscription(row)}
                      disabled={busyStoreId === row.store.id}
                      className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold disabled:opacity-50 touch-target whitespace-nowrap"
                    >
                      {busyStoreId === row.store.id ? 'Saving…' : 'Grant'}
                    </button>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-700">Warehouse / locations</p>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-xs text-slate-700">Warehouse enabled</span>
                      <input
                        type="checkbox"
                        checked={warehouseDraft.warehouse_enabled}
                        onChange={(e) =>
                          setWarehouseDrafts((prev) => ({
                            ...prev,
                            [row.store.id]: {
                              ...warehouseDraft,
                              warehouse_enabled: e.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-500 mb-1 block">Max shops</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={warehouseDraft.max_shops}
                          onChange={(e) =>
                            setWarehouseDrafts((prev) => ({
                              ...prev,
                              [row.store.id]: {
                                ...warehouseDraft,
                                max_shops: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                              },
                            }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 mb-1 block">Max warehouses</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={warehouseDraft.max_warehouses}
                          onChange={(e) =>
                            setWarehouseDrafts((prev) => ({
                              ...prev,
                              [row.store.id]: {
                                ...warehouseDraft,
                                max_warehouses: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                              },
                            }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveWarehouseLimits(row)}
                      disabled={busyStoreId === row.store.id}
                      className="w-full px-3 py-2 bg-slate-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50 touch-target"
                    >
                      {busyStoreId === row.store.id ? 'Saving…' : 'Save warehouse limits'}
                    </button>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-700">E-commerce storefront</p>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-xs text-slate-700">Public shop enabled</span>
                      <input
                        type="checkbox"
                        checked={ecommerceDraft.ecommerce_enabled}
                        onChange={(e) =>
                          setEcommerceDrafts((prev) => ({
                            ...prev,
                            [row.store.id]: {
                              ...ecommerceDraft,
                              ecommerce_enabled: e.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900"
                      />
                    </label>
                    <div>
                      <label className="text-[11px] text-slate-500 mb-1 block">
                        Public slug (#/shop/…)
                      </label>
                      <input
                        type="text"
                        value={ecommerceDraft.ecommerce_slug}
                        onChange={(e) =>
                          setEcommerceDrafts((prev) => ({
                            ...prev,
                            [row.store.id]: {
                              ...ecommerceDraft,
                              ecommerce_slug: e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9-]+/g, '-')
                                .replace(/^-+|-+$/g, '')
                                .slice(0, 60),
                            },
                          }))
                        }
                        placeholder="auto from store name if blank"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveEcommerce(row)}
                      disabled={busyStoreId === row.store.id}
                      className="w-full px-3 py-2 bg-emerald-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 touch-target"
                    >
                      {busyStoreId === row.store.id ? 'Saving…' : 'Save e-commerce'}
                    </button>
                  </div>
                </div>
              );
            })}

            {data.subscriptionGrants.length > 0 && (
              <div className="pt-2">
                <h2 className="text-sm font-bold text-slate-800 mb-2">Recent grants</h2>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  {data.subscriptionGrants.slice(0, 20).map((grant) => (
                    <div key={grant.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {storeName(grant.store_id)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {grant.months} month{grant.months === 1 ? '' : 's'} · until{' '}
                            {formatSubscriptionDate(grant.period_end)}
                          </p>
                        </div>
                        <p className="text-[11px] text-slate-500 flex-shrink-0">
                          {formatSubscriptionDate(grant.granted_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'contact' && (
          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
              These details appear on every store’s <strong>Plan</strong> screen so owners and cashiers can
              contact you to renew. mNotify powers SMS alerts when you grant a subscription and when a plan
              is nearing expiry.
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Public contact</h2>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 mb-1 block">WhatsApp number</label>
                <input
                  type="tel"
                  value={contactWhatsapp}
                  onChange={(e) => setContactWhatsapp(e.target.value)}
                  placeholder="e.g. 024XXXXXXX or +23324XXXXXXX"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 mb-1 block">Email address</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 mb-1 block">
                  Admin login phone (SMS OTP)
                </label>
                <input
                  type="tel"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  placeholder="024XXXXXXX — receives admin login codes"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Required for admin SMS verification after PIN. Falls back to WhatsApp number or
                  VITE_ADMIN_PHONE.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Smartphone className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">mNotify SMS</h2>
              </div>
              <p className="text-[11px] text-slate-500">
                Get an API key from mNotify. SMS is sent to each store’s Support Phone (or MoMo number)
                on activation and once when expiry is within 7 days.
              </p>
              <div>
                <label className="text-[11px] font-medium text-slate-500 mb-1 block">API key</label>
                <input
                  type="password"
                  value={mnotifyApiKey}
                  onChange={(e) => setMnotifyApiKey(e.target.value)}
                  placeholder="mNotify API key"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 mb-1 block">Sender ID</label>
                <input
                  type="text"
                  value={mnotifySenderId}
                  onChange={(e) => setMnotifySenderId(e.target.value.slice(0, 11))}
                  placeholder="Adimat"
                  maxLength={11}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <p className="text-[10px] text-slate-400 mt-1">Max 11 characters (approved sender ID)</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveContact()}
              disabled={savingContact}
              className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-semibold disabled:opacity-50 touch-target"
            >
              {savingContact ? 'Saving…' : 'Save contact settings'}
            </button>

            {platformSettings?.updated_at && (
              <p className="text-[11px] text-slate-500 text-center">
                Last updated {formatSubscriptionDate(platformSettings.updated_at)}
              </p>
            )}
          </div>
        )}

        {data && tab === 'payouts' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
              Remit each store’s weekly Paystack total to their MoMo account, then tap <strong>Mark sent</strong>.
              Cash sales stay with the store and are not included here.
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-500">Week Paystack total</p>
                <p className="text-xl font-bold text-slate-900">{formatGhs(data.totals.weekPaystack)}</p>
              </div>
              <CreditCard className="w-8 h-8 text-slate-300" />
            </div>

            {data.performance.filter((p) => p.weekPaystack > 0 || p.payoutStatus === 'sent').length === 0 && (
              <p className="text-sm text-slate-500 text-center py-10">No Paystack collections this week.</p>
            )}

            {data.performance
              .filter((p) => p.weekPaystack > 0 || p.payoutStatus === 'sent')
              .map((row) => (
                <div key={row.store.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{row.store.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{row.weekSales} online-capable sale(s) this week</p>
                    </div>
                    <p className="text-lg font-bold text-emerald-700">{formatGhs(row.weekPaystack)}</p>
                  </div>

                  <div className="mt-3 bg-slate-50 rounded-xl p-3 text-xs space-y-1">
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <Smartphone className="w-3.5 h-3.5" />
                      {row.store.momo_account_name || <span className="text-amber-700">No MoMo name set</span>}
                    </p>
                    <p className="text-slate-700 font-mono">
                      {row.store.momo_number || 'No MoMo number set'}
                      {row.store.momo_network ? ` · ${row.store.momo_network}` : ''}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    {row.payoutStatus === 'sent' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" /> Sent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                        <AlertCircle className="w-4 h-4" /> Pending remittance
                      </span>
                    )}
                    {row.payoutStatus !== 'sent' && (
                      <button
                        onClick={() => void handleMarkPaid(row)}
                        disabled={busyStoreId === row.store.id || row.weekPaystack <= 0}
                        className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold disabled:opacity-50 touch-target"
                      >
                        {busyStoreId === row.store.id ? 'Saving…' : 'Mark sent'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}

        {data && tab === 'stores' && (
          <div className="space-y-2">
            {selectedStoreId && data.stores.find((s) => s.id === selectedStoreId) ? (
              <AdminStoreWorkspace
                store={data.stores.find((s) => s.id === selectedStoreId)!}
                data={data}
                onBack={() => setSelectedStoreId(null)}
                onChanged={refresh}
              />
            ) : (
              <>
                <p className="text-xs text-slate-500 px-1">
                  Open a store to view its inventory and manage staff.
                </p>
                {data.performance.map((row) => (
                  <button
                    key={row.store.id}
                    type="button"
                    onClick={() => setSelectedStoreId(row.store.id)}
                    className="w-full text-left"
                  >
                    <StoreRevenueCard row={row} />
                  </button>
                ))}
                {data.stores.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-10">No stores synced to the cloud yet.</p>
                )}
              </>
            )}
          </div>
        )}

        {data && tab === 'users' && (
          <div className="space-y-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-900">
              Linked accounts show people who share the same phone across stores — including additional
              stores they opened on a device.
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-900">Linked stores by phone</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {linkedAccounts.length} phone identities · multi-store owners appear here
                </p>
              </div>
              {linkedAccounts.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8 px-4">
                  No user phones synced yet. Staff need a phone on their profile.
                </p>
              ) : (
                linkedAccounts.map((row) => (
                  <div key={row.phone} className="px-4 py-3 border-b border-slate-100 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{row.displayName}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{row.phone}</p>
                        <p className="text-[11px] text-slate-500 mt-1 capitalize">
                          {row.roles.join(', ')} · {row.userCount} account
                          {row.userCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
                        {row.storeIds.length} store{row.storeIds.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.storeNames.map((name) => (
                        <span
                          key={`${row.phone}-${name}`}
                          className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-800"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-900">All users</h2>
              </div>
              {data.users.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-10">No users found.</p>
              ) : (
                data.users.map((user) => (
                  <div key={user.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {storeName(user.store_id)}
                          {user.phone ? ` · ${user.phone}` : ' · no phone'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] uppercase font-bold tracking-wide text-slate-500">
                          {user.role}
                        </span>
                        {!user.is_active && (
                          <p className="text-[10px] text-red-500">Inactive</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {data && tab === 'products' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {data.products.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No products found.</p>
            ) : (
              data.products.slice(0, 300).map((product) => (
                <div key={product.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {storeName(product.store_id)} · {product.category}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-slate-900">{formatGhs(product.selling_price)}</p>
                      <p className="text-[11px] text-slate-500">Stock {product.stock_level}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
            {data.products.length > 300 && (
              <p className="text-[11px] text-slate-500 text-center py-3">Showing first 300 of {data.products.length}</p>
            )}
          </div>
        )}
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-emerald-100 bg-white/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-4 gap-0.5 px-1 py-1">
          {tabs.slice(0, 4).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id !== 'stores') setSelectedStoreId(null);
              }}
              className={`flex flex-col items-center justify-center rounded-xl px-1 py-2 touch-target ${
                tab === id ? 'bg-emerald-50 text-primary' : 'text-slate-500'
              }`}
            >
              <span className={`text-[11px] ${tab === id ? 'font-bold' : 'font-medium'}`}>{label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-0.5 px-1 pb-1">
          {tabs.slice(4).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id !== 'stores') setSelectedStoreId(null);
              }}
              className={`flex flex-col items-center justify-center rounded-xl px-1 py-2 touch-target ${
                tab === id ? 'bg-emerald-50 text-primary' : 'text-slate-500'
              }`}
            >
              <span className={`text-[11px] ${tab === id ? 'font-bold' : 'font-medium'}`}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3">
      <div className="text-slate-400 mb-2">{icon}</div>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function StoreRevenueCard({ row, compact = false }: { row: StorePerformance; compact?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 hover:border-emerald-200 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Store className="w-5 h-5 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 truncate">{row.store.name}</p>
          {!compact && row.store.address && (
            <p className="text-[11px] text-slate-500 truncate">{row.store.address}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-600">
            <span>{row.userCount} users</span>
            <span>{row.productCount} products</span>
            <span>{row.saleCount} sales</span>
          </div>
          <p className="text-[11px] text-emerald-700 font-semibold mt-2">Tap to open inventory &amp; staff</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Warehouse {row.store.warehouse_enabled ? 'on' : 'off'} · {row.store.max_shops} shop
            {row.store.max_shops === 1 ? '' : 's'} · {row.store.max_warehouses} warehouse
            {row.store.max_warehouses === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            E-commerce {row.store.ecommerce_enabled ? 'on' : 'off'}
            {row.store.ecommerce_slug ? ` · #/shop/${row.store.ecommerce_slug}` : ''}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div className="bg-slate-50 rounded-lg py-2">
          <p className="text-[10px] text-slate-500">Revenue</p>
          <p className="text-xs font-bold text-slate-900">{formatGhs(row.totalRevenue)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg py-2">
          <p className="text-[10px] text-emerald-700">Paystack</p>
          <p className="text-xs font-bold text-emerald-800">{formatGhs(row.paystackRevenue)}</p>
        </div>
        <div className="bg-amber-50 rounded-lg py-2">
          <p className="text-[10px] text-amber-700">Week MoMo</p>
          <p className="text-xs font-bold text-amber-800">{formatGhs(row.weekPaystack)}</p>
        </div>
      </div>
      {!compact && (
        <p className="text-[11px] text-slate-500 mt-2">
          MoMo: {row.store.momo_account_name || '—'} · {row.store.momo_number || 'not set'}
          {row.store.momo_network ? ` (${row.store.momo_network})` : ''}
        </p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Users, Package, Wallet, RefreshCcw, LogOut, ChevronLeft, ChevronRight,
  Smartphone, CheckCircle2, AlertCircle, Loader2, Store, CreditCard, CalendarClock, Mail,
  FileBarChart, Download, FileText, Ban, LayoutDashboard, MoreHorizontal, X, Search, Megaphone,
  BookOpen, Printer, UserPlus, LifeBuoy,
} from 'lucide-react';
import {
  AdminDashboardData,
  AdminTransactionItemRow,
  AdminTransactionRow,
  StorePerformance,
  StoreSubscriptionUsage,
  buildAdminReceiptData,
  formatGhs,
  getWeekEnd,
  getWeekStart,
  grantStoreSubscription,
  loadAdminDashboard,
  loadAdminTransactionItems,
  markWeeklyPayoutSent,
  setStoreAccessBlocked,
  shiftWeek,
  updateStoreEcommerce,
  updateStoreWarehouseLimits,
  buildLinkedUserStores,
} from '@/lib/adminPortal';
import { isPrinterConnected } from '@/lib/bluetoothPeripherals';
import { openComputerPrinterWindow, printReceipt } from '@/lib/printService';
import {
  AdminSystemReport,
  buildAdminSystemReport,
  exportAdminSystemReportCsv,
  exportAdminSystemReportPdf,
} from '@/lib/adminReports';
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
import AdminCreateStoreForm from '@/components/AdminCreateStoreForm';
import AdminCampaignManager from '@/components/AdminCampaignManager';
import AdminBroadcastSms from '@/components/AdminBroadcastSms';
import AdminSupportAgent from '@/components/AdminSupportAgent';
import CopyableStoreId from '@/components/CopyableStoreId';
import AdminAgentsPanel from '@/components/AdminAgentsPanel';
import CustomerCarePanel from '@/components/CustomerCarePanel';

type Tab = 'overview' | 'stores' | 'users' | 'products' | 'payouts' | 'subscriptions' | 'reports' | 'contact' | 'care' | 'broadcast' | 'campaigns' | 'learn' | 'sales' | 'agents';

function defaultReportFromDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultReportToDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
    Record<
      string,
      { warehouse_enabled: boolean; max_shops: number; max_warehouses: number; max_stores: number }
    >
  >({});
  const [ecommerceDrafts, setEcommerceDrafts] = useState<
    Record<string, { ecommerce_enabled: boolean; ecommerce_slug: string }>
  >({});
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [mnotifyApiKey, setMnotifyApiKey] = useState('');
  const [mnotifySenderId, setMnotifySenderId] = useState('Adimat');
  const [savingContact, setSavingContact] = useState(false);
  const [reportFrom, setReportFrom] = useState(defaultReportFromDate);
  const [reportTo, setReportTo] = useState(defaultReportToDate);
  const [systemReport, setSystemReport] = useState<AdminSystemReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [storeQuery, setStoreQuery] = useState('');
  const [salesQuery, setSalesQuery] = useState('');
  const [salesStoreFilter, setSalesStoreFilter] = useState('all');
  const [salesItems, setSalesItems] = useState<Record<string, AdminTransactionItemRow[]>>({});
  const [salesPreviewId, setSalesPreviewId] = useState<string | null>(null);
  const [printingSalesId, setPrintingSalesId] = useState<string | null>(null);
  const [salesStatus, setSalesStatus] = useState('');

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
              max_stores: store.max_stores,
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
      mnotify_api_key: mnotifyApiKey,
      mnotify_sender_id: mnotifySenderId,
    });
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to save contact settings');
    } else {
      setPlatformSettings(result.settings || null);
      setStatusMsg('Admin contact and notification settings saved.');
    }
    setSavingContact(false);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const getWarehouseDraft = (storeId: string, fallback?: {
    warehouse_enabled: boolean;
    max_shops: number;
    max_warehouses: number;
    max_stores: number;
  }) =>
    warehouseDrafts[storeId] ||
    fallback || {
      warehouse_enabled: false,
      max_shops: 1,
      max_warehouses: 0,
      max_stores: 1,
    };

  const handleSaveWarehouseLimits = async (row: StoreSubscriptionUsage) => {
    const draft = getWarehouseDraft(row.store.id, {
      warehouse_enabled: row.store.warehouse_enabled,
      max_shops: row.store.max_shops,
      max_warehouses: row.store.max_warehouses,
      max_stores: row.store.max_stores,
    });
    const maxShops = Math.max(1, Math.floor(Number(draft.max_shops) || 1));
    const maxWarehouses = Math.max(0, Math.floor(Number(draft.max_warehouses) || 0));
    const maxStores = Math.max(1, Math.floor(Number(draft.max_stores) || 1));

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await updateStoreWarehouseLimits(row.store.id, {
      warehouse_enabled: draft.warehouse_enabled,
      max_shops: maxShops,
      max_warehouses: maxWarehouses,
      max_stores: maxStores,
    });
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to save warehouse limits');
    } else {
      const saved = result.limits;
      setWarehouseDrafts((prev) => ({
        ...prev,
        [row.store.id]: {
          warehouse_enabled: saved?.warehouse_enabled ?? draft.warehouse_enabled,
          max_shops: saved?.max_shops ?? maxShops,
          max_warehouses: saved?.max_warehouses ?? maxWarehouses,
          max_stores: saved?.max_stores ?? maxStores,
        },
      }));
      setStatusMsg(
        result.error
          ? `Saved with warning: ${result.error}`
          : `Updated limits for ${row.store.name}: ${
              draft.warehouse_enabled ? 'warehouse on' : 'warehouse off'
            }, ${saved?.max_stores ?? maxStores} store${
              (saved?.max_stores ?? maxStores) === 1 ? '' : 's'
            }, ${saved?.max_shops ?? maxShops} shop${
              (saved?.max_shops ?? maxShops) === 1 ? '' : 's'
            }, ${saved?.max_warehouses ?? maxWarehouses} warehouse${
              (saved?.max_warehouses ?? maxWarehouses) === 1 ? '' : 's'
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

  const handleToggleStoreBlock = async (row: StoreSubscriptionUsage) => {
    const blocking = !row.store.access_blocked;
    const confirmMsg = blocking
      ? `Block ${row.store.name}? Staff will be locked out until they pay a subscription package or you unblock them.`
      : `Unblock ${row.store.name}? Staff will regain access to the POS immediately.`;
    if (!confirm(confirmMsg)) return;

    setBusyStoreId(row.store.id);
    setStatusMsg('');
    const result = await setStoreAccessBlocked(row.store.id, blocking);
    if (!result.success) {
      setStatusMsg(result.error || 'Failed to update store access');
    } else {
      setStatusMsg(
        blocking
          ? `${row.store.name} is blocked. They must pay a package before using the platform.`
          : `${row.store.name} is unblocked.`
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

  const visibleSales = useMemo<AdminTransactionRow[]>(() => {
    if (!data) return [];
    const needle = salesQuery.trim().toLowerCase();
    return data.transactions
      .filter((tx) => salesStoreFilter === 'all' || tx.store_id === salesStoreFilter)
      .filter((tx) => {
        if (!needle) return true;
        const store = data.stores.find((s) => s.id === tx.store_id)?.name || '';
        return (
          tx.receipt_number.toLowerCase().includes(needle) ||
          (tx.cashier_name || '').toLowerCase().includes(needle) ||
          store.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100);
  }, [data, salesQuery, salesStoreFilter]);

  const salesPreview = useMemo<AdminTransactionRow | null>(
    () => visibleSales.find((tx) => tx.id === salesPreviewId) || null,
    [visibleSales, salesPreviewId]
  );

  // Receipt line items are fetched once per receipt so the admin can print it.
  useEffect(() => {
    if (tab !== 'sales' || !data) return;
    const missing = visibleSales
      .map((tx) => tx.id)
      .filter((id) => !salesItems[id]);
    if (missing.length === 0) return;
    let active = true;
    void loadAdminTransactionItems(missing)
      .then((items) => {
        if (!active) return;
        setSalesItems((prev) => {
          const next = { ...prev };
          for (const item of items) {
            next[item.transaction_id] = [...(next[item.transaction_id] || []), item];
          }
          return next;
        });
      })
      .catch(() => {
        /* Items are optional — the receipt still prints without its lines. */
      });
    return () => {
      active = false;
    };
  }, [tab, data, visibleSales, salesItems]);

  const printAdminReceipt = useCallback(
    async (tx: AdminTransactionRow) => {
      setSalesStatus('');
      // Opened inside the click so the browser allows the print window.
      const printWindow = isPrinterConnected() ? undefined : openComputerPrinterWindow();
      setPrintingSalesId(tx.id);
      try {
        const items = salesItems[tx.id] || (await loadAdminTransactionItems([tx.id]));
        const store = data?.stores.find((s) => s.id === tx.store_id);
        const result = await printReceipt(buildAdminReceiptData(tx, items, store), printWindow);
        setSalesStatus(
          result.success
            ? `Receipt ${tx.receipt_number} sent to the printer`
            : result.error || 'Printing failed'
        );
      } catch (err: unknown) {
        setSalesStatus(err instanceof Error ? err.message : 'Printing failed');
      } finally {
        setPrintingSalesId(null);
        setTimeout(() => setSalesStatus(''), 4000);
      }
    },
    [data, salesItems]
  );

  const generateSystemReport = async () => {
    setReportLoading(true);
    setReportError('');
    try {
      const report = await buildAdminSystemReport(reportFrom, reportTo);
      setSystemReport(report);
      setStatusMsg(`System report ready for ${reportFrom} → ${reportTo}`);
    } catch (err: unknown) {
      setSystemReport(null);
      setReportError(err instanceof Error ? err.message : String(err));
    }
    setReportLoading(false);
  };

  const tabs = (
    [
      ['overview', 'Overview', LayoutDashboard],
      ['stores', 'Stores', Store],
      ['users', 'Users', Users],
      ['subscriptions', 'Subs', CalendarClock],
      ['payouts', 'Payouts', Wallet],
      ['products', 'Products', Package],
      ['sales', 'Sales', CreditCard],
      ['reports', 'Reports', FileBarChart],
      ['contact', 'Contact', Mail],
      ['care', 'Care', LifeBuoy],
      ['broadcast', 'Broadcast SMS', Megaphone],
      ['campaigns', 'Campaigns', Megaphone],
      ['agents', 'Agents', UserPlus],
      ['learn', 'Learn', BookOpen],
    ] as const
  );

  const primaryTabIds = ['overview', 'stores', 'subscriptions', 'payouts'] as const;
  const primaryTabs = tabs.filter((t) => (primaryTabIds as readonly string[]).includes(t[0]));
  const moreTabs = tabs.filter((t) => !(primaryTabIds as readonly string[]).includes(t[0]));
  const moreActive = moreTabs.some(([id]) => id === tab);

  const filteredStores = useMemo(() => {
    if (!data) return [];
    const q = storeQuery.trim().toLowerCase();
    const rows = data.performance;
    if (!q) return rows;
    return rows.filter((row) => {
      const name = row.store.name.toLowerCase();
      const id = row.store.id.toLowerCase();
      const phone = (row.store.support_number || '').toLowerCase();
      return name.includes(q) || id.includes(q) || phone.includes(q);
    });
  }, [data, storeQuery]);

  const goTab = (id: Tab) => {
    setTab(id);
    setMoreOpen(false);
    if (id !== 'stores') setSelectedStoreId(null);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <div
      className="ios-canvas h-full w-full min-w-0 flex flex-col overflow-hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <header className="ios-bar px-3 sm:px-4 md:px-6 lg:px-8 2xl:px-12 py-3 lg:py-4 2xl:py-5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted">Adimat Admin</p>
            <h1 className="truncate text-[22px] font-bold tracking-tight md:text-[28px]">
              {tabs.find(([id]) => id === tab)?.[1] || 'Admin'}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => void refresh()}
              className="touch-target rounded-full bg-black/[0.05] p-2.5 text-ink"
              title="Refresh"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleLogout}
              className="touch-target rounded-full bg-black/[0.05] p-2.5 text-ink"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(tab === 'overview' || tab === 'payouts') && (
          <div className="mt-3 flex items-center justify-between rounded-[14px] bg-black/[0.05] px-1.5 py-1.5 text-ink">
            <button
              onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
              className="p-2.5 touch-target"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center min-w-0 px-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Payout week</p>
              <p className="truncate text-xs font-semibold sm:text-sm">{weekStart} → {weekEnd}</p>
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
      <nav className="ios-pane hidden lg:flex flex-shrink-0 gap-1 overflow-x-auto border-b border-white/50 px-2 py-2 no-scrollbar md:px-4 lg:px-8 2xl:px-12">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => goTab(id)}
            className={`touch-target whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold ${
              tab === id ? 'bg-white text-primary shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)]' : 'text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-6 lg:px-8 2xl:px-12 py-3 md:py-5 lg:py-6 2xl:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading && !data && tab !== 'contact' && tab !== 'care' && tab !== 'reports' && tab !== 'learn' && tab !== 'agents' && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading cloud data…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-3">
            {error}
            {(error.includes('momo_') || error.includes('payouts') || error.includes('subscription') || error.includes('platform_settings') || error.includes('access_blocked') || error.includes('transactions_cleared_at') || error.includes('column')) && (
              <p className="text-xs mt-2">
                Run <code>supabase-migrate-admin.sql</code> / <code>supabase-migrate-subscriptions.sql</code> /{' '}
                <code>supabase-migrate-store-access-block.sql</code> /{' '}
                <code>supabase-migrate-clear-store-ledger.sql</code> /{' '}
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

        {tab === 'learn' && (
          <div className="mx-auto max-w-5xl space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Platform administrator and technical staff</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900">Learn Adimat administration</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                This reference is shown inside the authenticated administrator portal. Store owners and cashiers use
                their separate Learn Adimat guides in the store app.
              </p>
            </div>

            <figure className="overflow-hidden rounded-2xl border border-emerald-100 bg-white p-3">
              <img
                src="/learn/admin-dashboard.svg"
                alt="Illustration of the Adimat administrator portal overview and Learn tab"
                className="block h-auto w-full rounded-xl"
              />
              <figcaption className="mt-2 text-center text-xs text-slate-500">
                Administrator portal illustration; example figures only.
              </figcaption>
            </figure>

            <a
              href="/guides/adimat-admin-technical-guide.pdf"
              download
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white touch-target"
            >
              <Download className="h-4 w-4" />
              Download administrator and technical guide (PDF)
            </a>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">Provision and support stores</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>Create a store in Stores, issue its Store ID and owner PIN securely, and tell the owner to open it on their device.</li>
                <li>Use Subscriptions to grant access and configure optional warehouse or online-shop features. Confirm the store and limits before saving.</li>
                <li>Use Contact to maintain administrator contact details and configured notification settings.</li>
                <li>Before clearing trial sales, confirm the selected store and explain that ledger history is deleted; ask its staff to run a full sync afterward.</li>
              </ol>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">Configure and deploy the app</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>Use Node.js 18+ and npm. Install dependencies with <code>npm install</code>.</li>
                <li>Set the Vite build variables for Supabase URL/anon key and, if online payments are enabled, the Paystack public key.</li>
                <li>Build with <code>npm run build</code> and deploy the resulting <code>dist/</code> as a static site over HTTPS.</li>
                <li>All <code>VITE_</code> values are shipped to browsers. Never put a Supabase service-role key, Paystack secret key, or private credential in the client build.</li>
              </ol>
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-bold text-amber-950">Database and security precautions</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-950">
                <li>New Supabase projects start from <code>supabase-init.sql</code>. Existing projects need only the feature migrations required by their schema and enabled features.</li>
                <li>Back up production data and review migration SQL before applying it. Verify store sync and enabled workflows after a migration.</li>
                <li>The current client relies on local PIN checks and permissive cloud RLS policies. Do not treat hidden UI or store IDs as server-side tenant isolation; harden and test server-side RLS/authorization before untrusted multi-tenant production use.</li>
                <li>Downloaded backups include sensitive staff data. Store them securely, restrict access, and validate the target store before restore.</li>
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">Sync and release checklist</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>Full sync pulls cloud changes and pushes local changes. Check pending changes, last sync time, and error status before moving devices.</li>
                <li>Test owner and cashier sign-in separately, cash checkout, online payment configuration if used, inventory, sync in both directions, backup/restore, and any enabled warehouse or storefront features.</li>
                <li>For implementation and schema detail, consult the project’s <code>SYSTEM_DOCUMENTATION.md</code> and review the corresponding migration file.</li>
              </ul>
            </section>
          </div>
        )}

        {data && tab === 'overview' && (
          <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
            <div className="grid grid-cols-2 gap-2 xl:col-span-2 xl:grid-cols-4 xl:gap-3">
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
                <div>
                  <p className="text-[11px] text-slate-500">Blocked (unpaid)</p>
                  <p className="font-semibold text-red-700">{data.totals.storesBlocked}</p>
                </div>
              </div>
            </div>

            <section className="xl:col-span-2">
              <h2 className="text-sm font-bold text-slate-800">Stores by weekly Paystack</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {data.performance.slice(0, 8).map((row) => (
                  <StoreRevenueCard key={row.store.id} row={row} compact />
                ))}
              </div>
            </section>
          </div>
        )}

        {data && tab === 'subscriptions' && (
          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
              Grant monthly access to each store owner. Block a store that refuses to pay — they will
              see the subscription packages and must pay before using the POS. Paying or granting months
              unblocks them automatically.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Active" value={String(data.totals.subsActive)} />
              <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Expiring soon" value={String(data.totals.subsExpiringSoon)} />
              <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Expired" value={String(data.totals.subsExpired)} />
              <StatCard icon={<Ban className="w-4 h-4" />} label="Blocked" value={String(data.totals.storesBlocked)} />
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
                max_stores: row.store.max_stores,
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
                      <CopyableStoreId storeId={row.store.id} />
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.userCount} users · {row.productCount} products
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Stores max {row.store.max_stores} · Warehouse{' '}
                        {row.store.warehouse_enabled ? 'on' : 'off'} ·{' '}
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
                  {row.store.access_blocked && (
                    <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1">
                      <Ban className="w-3.5 h-3.5" />
                      Access blocked — paywall shown in store app
                    </p>
                  )}

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
                      {[1, 2, 3, 6, 12, 24, 36, 48].map((m) => (
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

                  <button
                    type="button"
                    onClick={() => void handleToggleStoreBlock(row)}
                    disabled={busyStoreId === row.store.id}
                    className={`mt-2 w-full px-3 py-2 rounded-xl text-xs font-semibold touch-target disabled:opacity-50 ${
                      row.store.access_blocked
                        ? 'bg-emerald-700 text-white'
                        : 'bg-red-600 text-white'
                    }`}
                  >
                    {busyStoreId === row.store.id
                      ? 'Saving…'
                      : row.store.access_blocked
                        ? 'Unblock store'
                        : 'Block store (unpaid)'}
                  </button>

                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-700">
                      Stores &amp; warehouse limits
                    </p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Saves to the cloud <span className="font-semibold">store_quotas</span> table.
                      If save fails, run <span className="font-mono">supabase-migrate-store-quotas.sql</span> in
                      Supabase.
                    </p>
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
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-500 mb-1 block">Max stores</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={warehouseDraft.max_stores}
                          onChange={(e) =>
                            setWarehouseDrafts((prev) => ({
                              ...prev,
                              [row.store.id]: {
                                ...warehouseDraft,
                                max_stores: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                              },
                            }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
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
                      {busyStoreId === row.store.id ? 'Saving…' : 'Save store & warehouse limits'}
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

        {data && tab === 'sales' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  value={salesQuery}
                  onChange={(e) => setSalesQuery(e.target.value)}
                  placeholder="Search receipt number, cashier or store…"
                  className="w-full text-sm outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSalesStoreFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    salesStoreFilter === 'all'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  All stores
                </button>
                {data.stores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSalesStoreFilter(store.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                      salesStoreFilter === store.id
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {store.name}
                  </button>
                ))}
              </div>
            </div>

            {salesStatus && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{salesStatus}</p>
            )}

            <div className="space-y-2">
              {visibleSales.map((tx) => (
                <div
                  key={tx.id}
                  className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => setSalesPreviewId(tx.id)}
                    className="min-w-0 text-left"
                  >
                    <p className="text-sm font-semibold text-slate-900 font-mono truncate">
                      {tx.receipt_number || 'Receipt'}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {storeName(tx.store_id)}
                      {tx.cashier_name ? ` · ${tx.cashier_name}` : ''}
                      {' · '}
                      {new Date(tx.created_at).toLocaleString()}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className="text-sm font-bold text-slate-900">{formatGhs(tx.total_amount)}</p>
                    <button
                      type="button"
                      onClick={() => void printAdminReceipt(tx)}
                      disabled={printingSalesId === tx.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                    >
                      {printingSalesId === tx.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Printer className="w-3.5 h-3.5" />
                      )}
                      Print
                    </button>
                  </div>
                </div>
              ))}
              {visibleSales.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-10">No sales match this filter.</p>
              )}
            </div>

            {salesPreview && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-900/50"
                  aria-label="Close"
                  onClick={() => setSalesPreviewId(null)}
                />
                <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl animate-slide-up">
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 rounded-t-3xl">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        Receipt
                      </p>
                      <p className="truncate text-sm font-bold text-slate-900 font-mono">
                        {salesPreview.receipt_number}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSalesPreviewId(null)}
                      className="icon-btn"
                      aria-label="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="px-4 py-4 space-y-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                      <p className="flex justify-between gap-3">
                        <span>Store</span>
                        <span className="font-semibold text-slate-900">{storeName(salesPreview.store_id)}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>Date</span>
                        <span className="font-semibold text-slate-900">
                          {new Date(salesPreview.created_at).toLocaleString()}
                        </span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>Cashier</span>
                        <span className="font-semibold text-slate-900">{salesPreview.cashier_name || 'Cashier'}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>Payment</span>
                        <span className="font-semibold text-slate-900">{salesPreview.payment_method}</span>
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 px-3 py-2">
                      {(salesItems[salesPreview.id] || []).length === 0 ? (
                        <p className="py-4 text-center text-xs text-slate-400">No items on this receipt.</p>
                      ) : (
                        (salesItems[salesPreview.id] || []).map((item) => (
                          <div
                            key={item.id}
                            className="flex justify-between gap-3 py-1.5 text-xs text-slate-700 border-b border-slate-100 last:border-0"
                          >
                            <span className="min-w-0">
                              <span className="font-semibold text-slate-900">{item.quantity}×</span>{' '}
                              <span className="break-words">{item.product_name}</span>
                            </span>
                            <span className="font-semibold flex-shrink-0">{formatGhs(item.subtotal)}</span>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs space-y-1">
                      <p className="flex justify-between gap-3 text-slate-600">
                        <span>Subtotal</span>
                        <span>
                          {formatGhs(
                            (salesItems[salesPreview.id] || []).reduce(
                              (sum, item) => sum + (item.subtotal || 0),
                              0
                            )
                          )}
                        </span>
                      </p>
                      {salesPreview.discount_applied > 0 && (
                        <p className="flex justify-between gap-3 text-red-500">
                          <span>Discount</span>
                          <span>-{formatGhs(salesPreview.discount_applied)}</span>
                        </p>
                      )}
                      <p className="flex justify-between gap-3 text-sm font-bold text-slate-900 border-t border-slate-200 pt-1.5">
                        <span>Total</span>
                        <span>{formatGhs(salesPreview.total_amount)}</span>
                      </p>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void printAdminReceipt(salesPreview)}
                        disabled={printingSalesId === salesPreview.id}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {printingSalesId === salesPreview.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Printer className="w-4 h-4" />
                        )}
                        Print receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => setSalesPreviewId(null)}
                        className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'care' && <CustomerCarePanel />}

        {tab === 'broadcast' && !loading && (
          <AdminBroadcastSms
            stores={data?.stores ?? []}
            users={data?.users ?? []}
            unavailable={data ? '' : error}
          />
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
                <AdminCreateStoreForm onCreated={refresh} />
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={storeQuery}
                    onChange={(e) => setStoreQuery(e.target.value)}
                    placeholder="Search stores or paste a Store ID"
                    className="w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 py-3 text-base"
                  />
                </div>
                <p className="text-xs text-slate-500 px-1">
                  {filteredStores.length} store{filteredStores.length === 1 ? '' : 's'} · tap a card to open inventory, staff, invoice, or clear trial sales
                </p>
                {filteredStores.map((row) => (
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
                  <p className="text-sm text-slate-500 text-center py-10">No stores in the cloud yet. Create one above.</p>
                )}
                {data.stores.length > 0 && filteredStores.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No stores match that search.</p>
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
                        <p className="text-[10px] font-mono text-slate-400 truncate">{user.store_id}</p>
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

{tab === 'campaigns' && <AdminCampaignManager />}

        {tab === 'agents' && <AdminAgentsPanel />}

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

        {tab === 'reports' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <FileBarChart className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-900">Whole-system report</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose a From and To date to aggregate sales and expenses across every store.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">From</span>
                  <input
                    type="date"
                    value={reportFrom}
                    max={reportTo}
                    onChange={(e) => setReportFrom(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">To</span>
                  <input
                    type="date"
                    value={reportTo}
                    min={reportFrom}
                    max={defaultReportToDate()}
                    onChange={(e) => setReportTo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void generateSystemReport()}
                disabled={reportLoading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold touch-target disabled:opacity-60"
              >
                {reportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
                Generate report
              </button>

              {reportError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-xs">
                  {reportError}
                </div>
              )}
            </div>

            {reportLoading && !systemReport && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <Loader2 className="w-7 h-7 animate-spin mb-2" />
                <p className="text-sm">Building system report…</p>
              </div>
            )}

            {systemReport && (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Report period</p>
                      <p className="text-sm font-bold text-slate-900">
                        {systemReport.fromDate} → {systemReport.toDate}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => exportAdminSystemReportCsv(systemReport)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 touch-target"
                      >
                        <Download className="w-3.5 h-3.5" />
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => exportAdminSystemReportPdf(systemReport)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 touch-target"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        PDF
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <StatCard
                      icon={<Store className="w-4 h-4" />}
                      label="Stores (active)"
                      value={`${systemReport.totals.storesWithActivity}/${systemReport.totals.stores}`}
                    />
                    <StatCard
                      icon={<Wallet className="w-4 h-4" />}
                      label="Sales"
                      value={String(systemReport.totals.sales)}
                    />
                    <StatCard
                      icon={<CreditCard className="w-4 h-4" />}
                      label="Revenue"
                      value={formatGhs(systemReport.totals.revenue)}
                    />
                    <StatCard
                      icon={<Wallet className="w-4 h-4" />}
                      label="Cash"
                      value={formatGhs(systemReport.totals.cashRevenue)}
                    />
                    <StatCard
                      icon={<CreditCard className="w-4 h-4" />}
                      label="Paystack"
                      value={formatGhs(systemReport.totals.paystackRevenue)}
                    />
                    <StatCard
                      icon={<Package className="w-4 h-4" />}
                      label="Expenses"
                      value={formatGhs(systemReport.totals.expenses)}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-3">
                    Snapshot: {systemReport.totals.users} users · {systemReport.totals.products} products ·{' '}
                    {systemReport.totals.expenseCount} expense entries
                  </p>
                </div>

                <h2 className="text-sm font-bold text-slate-800 pt-1">By store</h2>
                {systemReport.byStore.filter((s) => s.sales > 0 || s.expenseCount > 0).length === 0 ? (
                  <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                    No sales or expenses in this date range.
                  </div>
                ) : (
                  systemReport.byStore
                    .filter((s) => s.sales > 0 || s.expenseCount > 0)
                    .map((row) => (
                      <div key={row.storeId} className="bg-white rounded-2xl border border-slate-200 p-4">
                        <p className="font-bold text-slate-900 truncate">{row.storeName}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
                          <div className="bg-slate-50 rounded-lg py-2">
                            <p className="text-[10px] text-slate-500">Sales</p>
                            <p className="text-xs font-bold text-slate-900">{row.sales}</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg py-2">
                            <p className="text-[10px] text-slate-500">Revenue</p>
                            <p className="text-xs font-bold text-slate-900">{formatGhs(row.revenue)}</p>
                          </div>
                          <div className="bg-emerald-50 rounded-lg py-2">
                            <p className="text-[10px] text-emerald-700">Paystack</p>
                            <p className="text-xs font-bold text-emerald-800">{formatGhs(row.paystackRevenue)}</p>
                          </div>
                          <div className="bg-rose-50 rounded-lg py-2">
                            <p className="text-[10px] text-rose-700">Expenses</p>
                            <p className="text-xs font-bold text-rose-800">{formatGhs(row.expenses)}</p>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="ios-tabbar lg:hidden fixed bottom-0 z-40"
        style={{
          left: 'env(safe-area-inset-left)',
          right: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="grid grid-cols-5 gap-0.5 px-1.5 py-1.5">
          {primaryTabs.map(([id, label, Icon]) => {
            const active = tab === id && !moreOpen;
            return (
              <button
                key={id}
                type="button"
                onClick={() => goTab(id)}
                data-active={active}
                className="ios-tab-item flex touch-target flex-col items-center justify-center gap-0.5 px-1 py-1.5"
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.8} />
                <span className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                  {label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            data-active={moreOpen || moreActive}
            className="ios-tab-item flex touch-target flex-col items-center justify-center gap-0.5 px-1 py-1.5"
            aria-expanded={moreOpen}
            aria-label="More admin tools"
          >
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={moreOpen || moreActive ? 2.4 : 1.8} />
            <span className={`text-[10px] leading-none ${moreOpen || moreActive ? 'font-semibold' : 'font-medium'}`}>
              More
            </span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="ios-glass relative rounded-t-[20px] shadow-2xl animate-slide-up"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="px-4 pb-2 pt-2">
              <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-black/20" />
              <div className="flex items-center justify-between">
              <p className="text-[17px] font-semibold tracking-tight text-ink">More</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 touch-target"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {moreTabs.map(([id, label, Icon]) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goTab(id)}
                    className={`flex items-center gap-3 rounded-[14px] bg-white px-3 py-3 text-left touch-target shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)] ${
                      active ? 'text-primary' : 'text-ink'
                    }`}
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                      active ? 'bg-primary text-white' : 'bg-white text-primary shadow-sm'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={`text-sm ${active ? 'font-bold' : 'font-semibold'}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
          <CopyableStoreId storeId={row.store.id} />
          {row.store.access_blocked && (
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 mt-0.5">
              Access blocked
            </p>
          )}
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
            Stores max {row.store.max_stores} · Warehouse {row.store.warehouse_enabled ? 'on' : 'off'} ·{' '}
            {row.store.max_shops} shop
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
  Wallet,
  Package,
  AlertCircle,
  ArrowRightLeft,
} from 'lucide-react';
import { listLocalStores, type LocalStore } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import {
  buildConsolidatedSummary,
  type ConsolidatedStoreSummary,
  type ConsolidatedSummary,
} from '@/lib/storeConsolidation';
import { useLiveStoreSales } from '@/hooks/useLiveStoreSales';

interface MultiStorePageProps {
  onNavigate: (page: string) => void;
}

type PeriodTab = 'today' | 'month';

function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export default function MultiStorePage({ onNavigate }: MultiStorePageProps) {
  const { currentStore, switchStore } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const [stores, setStores] = useState<LocalStore[]>([]);
  const [summary, setSummary] = useState<ConsolidatedSummary | null>(null);
  const [tab, setTab] = useState<PeriodTab>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError('');
    try {
      const localStores = await listLocalStores();
      setStores(localStores);
      const built = await buildConsolidatedSummary(localStores, currentStore?.id ?? null);
      setSummary(built);
    } catch (loadError) {
      console.error('[MultiStore] Could not build consolidated view:', loadError);
      setError('Could not build the consolidated view. Check the connection and refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentStore?.id]);

  // A sale on any till refreshes every store in the consolidated view.
  const { status: liveStatus } = useLiveStoreSales(
    currentStore?.id,
    useCallback(() => {
      void load();
    }, [load]),
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [load]);

  const totals = summary?.totals ?? null;
  const mixedCurrencies = useMemo(() => {
    if (!summary) return false;
    const codes = new Set(summary.stores.map((store) => store.currencyCode));
    return codes.size > 1;
  }, [summary]);

  const handleOpenStore = async (store: ConsolidatedStoreSummary) => {
    if (store.isCurrent) return;
    setSwitchingTo(store.storeId);
    try {
      await switchStore(store.storeId);
    } catch (switchError) {
      console.error('[MultiStore] Could not switch store:', switchError);
      setError('Could not open that store. Try again from Settings → My Stores.');
      setSwitchingTo(null);
    }
  };

  const handleExport = () => {
    if (!summary) return;
    const header = [
      'Store',
      'Today sales',
      'Today cash',
      'Today non-cash',
      'Today transactions',
      'Month sales',
      'Month expenses',
      'Month net profit',
      'Outstanding credit',
      'Low stock items',
      'Products',
    ];
    const rows = summary.stores.map((store) => [
      store.name,
      store.todaySales,
      store.todayCash,
      store.todayNonCash,
      store.todayTransactions,
      store.monthSales,
      store.monthExpenses,
      store.monthNetProfit,
      store.outstandingCredit,
      store.lowStockCount,
      store.productCount,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `adimat-all-stores-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 mb-2">
              <Building2 className="h-3.5 w-3.5" />
              <span>All stores</span>
            </div>
            <h1 className="text-white font-bold text-lg tracking-tight">{t('multistore.title')}</h1>
            <p className="text-emerald-200 text-xs mt-0.5">
              {summary
                ? `${summary.totals.storeCount} ${t('multistore.storesLinked')}`
                : t('multistore.subtitle')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                liveStatus === 'live' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-white/10 text-emerald-200/80'
              }`}
            >
              {liveStatus === 'live' ? t('dashboard.live') : t('dashboard.offline')}
            </span>
            <button
              type="button"
              onClick={() => void load(true)}
              className="rounded-lg bg-white/15 p-2 text-white touch-target"
              aria-label="Refresh consolidated view"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar space-y-4">
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-gray-500">Loading your stores…</p>
          </div>
        ) : !summary || summary.stores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 mb-4">
              <Building2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="font-semibold text-gray-900">No stores to consolidate yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Link or create another store from Settings → My Stores to compare performance.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              <ArrowRightLeft className="h-4 w-4" /> Manage my stores
            </button>
          </div>
        ) : (
          <>
            {mixedCurrencies && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                These stores use different currencies. Totals add the raw amounts together, so read
                them as a rough combined view.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <article className="col-span-2 rounded-2xl bg-white p-4 shadow-sm border border-emerald-50">
                <div className="flex items-center gap-2 text-gray-500">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">
                    {tab === 'today' ? t('multistore.combinedToday') : t('multistore.combinedMonth')}
                  </span>
                </div>
                <p className="mt-1 text-3xl font-bold text-gray-900">
                  {money(tab === 'today' ? totals!.todaySales : totals!.monthSales)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {tab === 'today'
                    ? `${totals!.todayTransactions} sale${totals!.todayTransactions === 1 ? '' : 's'} · ${money(totals!.todayCash)} cash`
                    : `${money(totals!.monthNetProfit)} net profit after costs and expenses`}
                </p>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 text-gray-500">
                  <Wallet className="h-4 w-4 text-rose-500" />
                  <span className="text-xs font-medium">{t('multistore.creditOwed')}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-rose-900">{money(totals!.outstandingCredit)}</p>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 text-gray-500">
                  <Package className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-medium">{t('multistore.lowStock')}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-amber-900">{totals!.lowStockCount}</p>
              </article>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex rounded-xl bg-gray-100 p-1">
                {(['today', 'month'] as PeriodTab[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      tab === value ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {value === 'today' ? t('multistore.today') : t('multistore.thisMonth')}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 touch-target"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            </div>

            <section className="space-y-3">
              {summary.stores.map((store) => (
                <article
                  key={store.storeId}
                  className={`rounded-2xl border p-4 shadow-sm ${
                    store.isCurrent ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-900">{store.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">
                        {store.address || 'No address'}
                      </p>
                      {store.isCurrent && (
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                          Current store
                        </p>
                      )}
                    </div>
                    {!store.isCurrent && (
                      <button
                        type="button"
                        disabled={switchingTo === store.storeId}
                        onClick={() => void handleOpenStore(store)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white touch-target disabled:opacity-50"
                      >
                        {switchingTo === store.storeId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        )}
                        Open
                      </button>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/70 px-2.5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-gray-400">Today</dt>
                      <dd className="mt-0.5 font-bold text-gray-900">{money(store.todaySales)}</dd>
                      <dd className="text-[11px] text-gray-500">
                        {store.todayTransactions} sale{store.todayTransactions === 1 ? '' : 's'}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/70 px-2.5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-gray-400">{t('multistore.monthProfit')}</dt>
                      <dd
                        className={`mt-0.5 font-bold ${
                          store.monthNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {money(store.monthNetProfit)}
                      </dd>
                      <dd className="text-[11px] text-gray-500">{money(store.monthSales)} sold</dd>
                    </div>
                    <div className="rounded-lg bg-white/70 px-2.5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-gray-400">{t('multistore.creditOwed')}</dt>
                      <dd className="mt-0.5 font-bold text-gray-900">{money(store.outstandingCredit)}</dd>
                    </div>
                    <div className="rounded-lg bg-white/70 px-2.5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-gray-400">{t('multistore.lowStock')}</dt>
                      <dd className="mt-0.5 font-bold text-gray-900">
                        {store.lowStockCount}
                        <span className="ml-1 font-normal text-gray-500">of {store.productCount}</span>
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-[11px] text-gray-400">
                    {t('multistore.lastSale')} {formatStamp(store.lastSaleAt)}
                  </p>
                </article>
              ))}
            </section>

            {stores.length > 1 && (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm touch-target"
              >
                <span>
                  <span className="block text-sm font-semibold text-gray-900">Manage my stores</span>
                  <span className="block text-xs text-gray-500">Link another store or transfer stock</span>
                </span>
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

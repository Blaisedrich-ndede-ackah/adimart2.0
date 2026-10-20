import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Radio,
  WifiOff,
  Target,
  Users,
  Building2,
  ArrowRightLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  db,
  getCurrentStoreId,
  listLocalStores,
  type LocalProduct,
  type LocalTransaction,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { toQty } from '@/lib/warehouse';
import { buildCustomerBalances } from '@/lib/customerBalances';
import { useLiveStoreSales } from '@/hooks/useLiveStoreSales';

interface OwnerHomePageProps {
  onNavigate: (page: string, quickAdd?: boolean) => void;
}

interface QuickAction {
  label: string;
  detail: string;
  page: string;
  quickAdd?: boolean;
  icon: LucideIcon;
  className: string;
}

function startOfToday(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function OwnerHomePage({ onNavigate }: OwnerHomePageProps) {
  const { currentStore } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [monthSales, setMonthSales] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [outstandingCredit, setOutstandingCredit] = useState(0);
  const [dailyTarget, setDailyTarget] = useState(0);
  const [monthlyTarget, setMonthlyTarget] = useState(0);
  const [linkedStoreCount, setLinkedStoreCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return;
    setError('');
    try {
      const start = startOfToday().getTime();
      const monthStart = startOfMonth().getTime();
      const [allTransactions, products, storeRow, balances, stores] = await Promise.all([
        db.transactions.where('store_id').equals(storeId).toArray(),
        db.products.where('store_id').equals(storeId).and((product) => product.is_active === 1).toArray(),
        db.stores.get(storeId),
        buildCustomerBalances(storeId),
        listLocalStores(),
      ]);

      const completed = allTransactions.filter((transaction) => transaction.status === 'completed');
      setTransactions(
        completed.filter((transaction) =>
          new Date(transaction.created_at).getTime() >= start
        )
      );
      setMonthSales(
        completed.reduce(
          (total, transaction) =>
            new Date(transaction.created_at).getTime() >= monthStart
              ? total + toNumber(transaction.total_amount)
              : total,
          0
        )
      );
      setLowStockCount(products.filter((product: LocalProduct) => {
        const level = toNumber(product.reorder_level) > 0 ? toNumber(product.reorder_level) : 5;
        return toQty(product.stock_level) <= level;
      }).length);
      setOutOfStockCount(products.filter((product: LocalProduct) => toQty(product.stock_level) <= 0).length);

      let credit = 0;
      for (const balance of balances.values()) credit += balance.total;
      setOutstandingCredit(credit);

      setDailyTarget(toNumber(storeRow?.sales_target_daily));
      setMonthlyTarget(toNumber(storeRow?.sales_target_monthly));
      setLinkedStoreCount(Math.max(1, stores.length));
    } catch (loadError) {
      console.error('[Dashboard] Could not load store overview:', loadError);
      setError('Could not load today’s store summary. Check the connection and refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Live feed: a sale on any device refreshes this screen straight away.
  // The polling fallback keeps the screen fresh without a cloud connection.
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
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load, currentStore?.id]);

  const totalSales = transactions.reduce((total, transaction) => total + toNumber(transaction.total_amount), 0);
  const cashTotal = transactions.reduce((total, transaction) => total + toNumber(transaction.cash_amount), 0);
  const nonCashTotal = transactions.reduce(
    (total, transaction) => total + toNumber(transaction.paystack_amount) + toNumber(transaction.manual_payment_amount),
    0
  );
  const averageBasket = transactions.length > 0 ? totalSales / transactions.length : 0;

  const recentSales = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 6),
    [transactions]
  );

  const dailyProgress = dailyTarget > 0 ? Math.min(100, (totalSales / dailyTarget) * 100) : 0;
  const monthlyProgress = monthlyTarget > 0 ? Math.min(100, (monthSales / monthlyTarget) * 100) : 0;

  const actions: QuickAction[] = [
    { label: 'New sale', detail: 'Open the till', page: 'pos', icon: ShoppingCart, className: 'bg-primary text-white' },
    { label: 'Sales records', detail: 'View and print receipts', page: 'transactions', icon: Receipt, className: 'bg-white text-primary border border-emerald-100' },
    { label: 'Add product', detail: 'Update your catalog', page: 'inventory', quickAdd: true, icon: Package, className: 'bg-white text-primary border border-emerald-100' },
    { label: 'Restock', detail: 'Replenish low stock', page: 'inventory', icon: Package, className: 'bg-white text-primary border border-amber-100' },
    { label: 'Add expense', detail: 'Record a store cost', page: 'expenses', quickAdd: true, icon: Plus, className: 'bg-white text-primary border border-emerald-100' },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wide">Owner dashboard</p>
            <h1 className="mt-1 text-white text-xl font-bold truncate">{currentStore?.name || 'Your store'}</h1>
            <p className="mt-1 text-emerald-100 text-xs">Today at a glance</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              liveStatus === 'live' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-white/10 text-emerald-200/80'
            }`}
            title={liveStatus === 'live' ? 'Live sales feed connected' : 'Live feed unavailable — showing the last saved numbers'}
          >
            {liveStatus === 'live' ? <Radio className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {liveStatus === 'live' ? t('dashboard.live') : t('dashboard.offline')}
          </span>
        </div>
      </div>
      <div className="page-body no-scrollbar space-y-4">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold">Refresh</button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3" aria-label="Today's store summary">
          <article className="col-span-2 rounded-2xl bg-white p-4 shadow-sm border border-emerald-50">
            <div className="flex items-center gap-2 text-gray-500">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Today’s sales</span>
            </div>
            {loading ? <div className="mt-3 h-8 w-40 animate-pulse rounded bg-gray-100" /> : (
              <>
                <p className="mt-1 text-3xl font-bold text-gray-900">{money(totalSales)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {transactions.length} completed sale{transactions.length === 1 ? '' : 's'}
                  {transactions.length > 0 ? ` · ${money(averageBasket)} average basket` : ''}
                </p>
              </>
            )}
          </article>
          <article className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-500">
              <Banknote className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-medium">Cash received</span>
            </div>
            {loading ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-gray-100" /> : <p className="mt-2 text-lg font-bold">{money(cashTotal)}</p>}
          </article>
          <article className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-500">
              <CreditCard className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-medium">Non-cash received</span>
            </div>
            {loading ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-gray-100" /> : <p className="mt-2 text-lg font-bold">{money(nonCashTotal)}</p>}
          </article>
          <button type="button" onClick={() => onNavigate('customers')} className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-left touch-target">
            <span className="flex items-center gap-2 text-gray-500">
              <Users className="h-4 w-4 text-rose-500" />
              <span className="text-xs font-medium">{t('dashboard.creditOwed')}</span>
            </span>
            {loading ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-rose-100" /> : (
              <p className="mt-2 text-lg font-bold text-rose-900">{money(outstandingCredit)}</p>
            )}
          </button>
          <button type="button" onClick={() => onNavigate('inventory')} className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-left touch-target">
            <span className="flex items-center gap-2 text-gray-500">
              <Package className="h-4 w-4 text-amber-700" />
              <span className="text-xs font-medium">Low-stock products</span>
            </span>
            <p className="mt-2 text-lg font-bold text-amber-950">{loading ? '…' : lowStockCount}</p>
          </button>
          <button type="button" onClick={() => onNavigate('inventory')} className="rounded-2xl border border-red-100 bg-red-50 p-4 text-left touch-target">
            <span className="flex items-center gap-2 text-gray-500">
              <Package className="h-4 w-4 text-red-600" />
              <span className="text-xs font-medium">Out of stock</span>
            </span>
            <p className="mt-2 text-lg font-bold text-red-950">{loading ? '…' : outOfStockCount}</p>
          </button>
        </section>

        {/* Sales targets */}
        {(dailyTarget > 0 || monthlyTarget > 0) && (
          <section className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100" aria-label="Sales targets">
            <div className="flex items-center gap-2 text-gray-500">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">{t('dashboard.target')}</span>
            </div>
            <div className="mt-3 space-y-3">
              {dailyTarget > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-600">Today</span>
                    <span className="font-semibold text-gray-900">
                      {money(totalSales)} / {money(dailyTarget)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${dailyProgress >= 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                      style={{ width: `${Math.max(2, dailyProgress)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {dailyProgress >= 100
                      ? 'Daily target reached.'
                      : `${Math.round(dailyProgress)}% of today’s target.`}
                  </p>
                </div>
              )}
              {monthlyTarget > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-600">This month</span>
                    <span className="font-semibold text-gray-900">
                      {money(monthSales)} / {money(monthlyTarget)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${monthlyProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.max(2, monthlyProgress)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {monthlyProgress >= 100
                      ? 'Monthly target reached.'
                      : `${Math.round(monthlyProgress)}% of this month’s target.`}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Live sales feed */}
        <section className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100" aria-label="Latest sales">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">{t('dashboard.latestSales')}</h2>
            <div className="flex items-center gap-3">
              {liveStatus === 'live' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                  <Radio className="h-3 w-3" /> {t('dashboard.live')}
                </span>
              )}
              <button
                type="button"
                onClick={() => onNavigate('transactions')}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                {t('sales.recordsTitle')}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="mt-3 space-y-2">
              <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
              <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
            </div>
          ) : recentSales.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No sales recorded today yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-50">
              {recentSales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {sale.receipt_number || 'Sale'}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {sale.cashier_name || 'Staff'} · {timeAgo(sale.created_at)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-primary">{money(toNumber(sale.total_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-gray-900">Quick actions</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {actions.map(({ label, detail, page, quickAdd, icon: Icon, className }) => (
              <button key={`${page}-${label}`} type="button" onClick={() => onNavigate(page, quickAdd)} className={`flex items-center gap-3 rounded-xl p-3 text-left shadow-sm touch-target ${className}`}>
                <Icon className="h-5 w-5 shrink-0" />
                <span><span className="block text-sm font-semibold">{label}</span><span className="block text-[11px] opacity-75">{detail}</span></span>
              </button>
            ))}
          </div>
        </section>

        {linkedStoreCount > 1 && (
          <button type="button" onClick={() => onNavigate('multistore')} className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm touch-target">
            <span className="flex items-center gap-3">
              <span className="rounded-lg bg-emerald-50 p-2">
                <Building2 className="h-5 w-5 text-primary" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">{t('dashboard.allStores')}</span>
                <span className="block text-xs text-gray-500">
                  {linkedStoreCount} stores · {t('dashboard.combinedPerformance')}
                </span>
              </span>
            </span>
            <ArrowRightLeft className="h-5 w-5 text-primary" />
          </button>
        )}

        <button type="button" onClick={() => onNavigate('transactions')} className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm touch-target">
          <span><span className="block text-sm font-semibold text-gray-900">Sales Records</span><span className="block text-xs text-gray-500">See every receipt and print it again</span></span>
          <Receipt className="h-5 w-5 text-primary" />
        </button>
      </div>
    </div>
  );
}

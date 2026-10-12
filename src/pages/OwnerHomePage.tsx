import { useCallback, useEffect, useState } from 'react';
import { Banknote, CreditCard, Package, Plus, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { db, getCurrentStoreId, type LocalProduct, type LocalTransaction } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { toQty } from '@/lib/warehouse';

interface OwnerHomePageProps {
  onNavigate: (page: string, quickAdd?: boolean) => void;
}

function startOfToday(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export default function OwnerHomePage({ onNavigate }: OwnerHomePageProps) {
  const { currentStore } = useAuthStore();
  const money = useFormatMoney();
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return;
    setError('');
    try {
      const start = startOfToday().getTime();
      const [allTransactions, products] = await Promise.all([
        db.transactions.where('store_id').equals(storeId).toArray(),
        db.products.where('store_id').equals(storeId).and((product) => product.is_active === 1).toArray(),
      ]);
      setTransactions(
        allTransactions.filter((transaction) =>
          transaction.status === 'completed' && new Date(transaction.created_at).getTime() >= start
        )
      );
      setLowStockCount(products.filter((product: LocalProduct) => {
        const level = Number(product.reorder_level) > 0 ? Number(product.reorder_level) : 5;
        return toQty(product.stock_level) <= level;
      }).length);
    } catch (loadError) {
      console.error('[Dashboard] Could not load store overview:', loadError);
      setError('Could not load today’s store summary. Check the connection and refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load, currentStore?.id]);

  const totalSales = transactions.reduce((total, transaction) => total + Number(transaction.total_amount || 0), 0);
  const cashTotal = transactions.reduce((total, transaction) => total + Number(transaction.cash_amount || 0), 0);
  const nonCashTotal = transactions.reduce(
    (total, transaction) => total + Number(transaction.paystack_amount || 0) + Number(transaction.manual_payment_amount || 0),
    0
  );
  const actions = [
    { label: 'New sale', detail: 'Open the till', page: 'pos', icon: ShoppingCart, className: 'bg-primary text-white' },
    { label: 'Add product', detail: 'Update your catalog', page: 'inventory', quickAdd: true, icon: Package, className: 'bg-white text-primary border border-emerald-100' },
    { label: 'Add expense', detail: 'Record a store cost', page: 'expenses', quickAdd: true, icon: Plus, className: 'bg-white text-primary border border-emerald-100' },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wide">Owner dashboard</p>
        <h1 className="mt-1 text-white text-xl font-bold">{currentStore?.name || 'Your store'}</h1>
        <p className="mt-1 text-emerald-100 text-xs">Today at a glance</p>
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
                <p className="mt-1 text-xs text-gray-500">{transactions.length} completed sale{transactions.length === 1 ? '' : 's'}</p>
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
          <button type="button" onClick={() => onNavigate('inventory')} className="col-span-2 flex items-center justify-between rounded-2xl border border-amber-100 bg-amber-50 p-4 text-left touch-target">
            <span>
              <span className="block text-xs font-medium text-amber-900">Low-stock products</span>
              <span className="mt-1 block text-2xl font-bold text-amber-950">{loading ? '…' : lowStockCount}</span>
            </span>
            <Package className="h-6 w-6 text-amber-700" />
          </button>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-gray-900">Quick actions</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {actions.map(({ label, detail, page, quickAdd, icon: Icon, className }) => (
              <button key={page} type="button" onClick={() => onNavigate(page, quickAdd)} className={`flex items-center gap-3 rounded-xl p-3 text-left shadow-sm touch-target ${className}`}>
                <Icon className="h-5 w-5 shrink-0" />
                <span><span className="block text-sm font-semibold">{label}</span><span className="block text-[11px] opacity-75">{detail}</span></span>
              </button>
            ))}
          </div>
        </section>

        <button type="button" onClick={() => onNavigate('transactions')} className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm touch-target">
          <span><span className="block text-sm font-semibold text-gray-900">Sales history</span><span className="block text-xs text-gray-500">Review receipts and transactions</span></span>
          <Receipt className="h-5 w-5 text-primary" />
        </button>
      </div>
    </div>
  );
}

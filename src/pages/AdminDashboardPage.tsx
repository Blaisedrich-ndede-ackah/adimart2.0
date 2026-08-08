import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Users, Package, Wallet, RefreshCcw, LogOut, ChevronLeft, ChevronRight,
  Smartphone, CheckCircle2, AlertCircle, Loader2, Store, CreditCard
} from 'lucide-react';
import {
  AdminDashboardData,
  StorePerformance,
  formatGhs,
  getWeekEnd,
  getWeekStart,
  loadAdminDashboard,
  markWeeklyPayoutSent,
  shiftWeek,
} from '@/lib/adminPortal';
import { clearAdminSession } from '@/lib/adminAuth';

type Tab = 'overview' | 'stores' | 'users' | 'products' | 'payouts';

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

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const dashboard = await loadAdminDashboard(weekStart);
      setData(dashboard);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setData(null);
    }
    setLoading(false);
  }, [weekStart]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const storeName = (storeId: string) =>
    data?.stores.find((s) => s.id === storeId)?.name || 'Unknown store';

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-slate-950 text-white px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-emerald-300 text-[10px] font-semibold uppercase tracking-wide">Adimat Admin</p>
            <h1 className="text-lg font-bold">Platform Overview</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="p-2 rounded-xl bg-white/10 touch-target"
              title="Refresh"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl bg-white/10 touch-target"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between bg-white/10 rounded-xl px-2 py-2">
          <button
            onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
            className="p-2 touch-target"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-[10px] text-slate-300 uppercase">Payout week</p>
            <p className="text-sm font-semibold">{weekStart} → {weekEnd}</p>
          </div>
          <button
            onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
            className="p-2 touch-target"
            disabled={weekStart >= getWeekStart()}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 px-2 py-2 flex gap-1 overflow-x-auto no-scrollbar flex-shrink-0">
        {([
          ['overview', 'Overview'],
          ['payouts', 'Payouts'],
          ['stores', 'Stores'],
          ['users', 'Users'],
          ['products', 'Products'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap touch-target ${
              tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-3 py-3 pb-8">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading cloud data…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-3">
            {error}
            {(error.includes('momo_') || error.includes('payouts') || error.includes('column')) && (
              <p className="text-xs mt-2">
                Run <code>supabase-migrate-admin.sql</code> (or the latest <code>supabase-init.sql</code>) in your Supabase SQL Editor.
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

            <h2 className="text-sm font-bold text-slate-800 pt-1">Stores by weekly Paystack</h2>
            {data.performance.slice(0, 8).map((row) => (
              <StoreRevenueCard key={row.store.id} row={row} compact />
            ))}
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
            {data.performance.map((row) => (
              <StoreRevenueCard key={row.store.id} row={row} />
            ))}
            {data.stores.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-10">No stores synced to the cloud yet.</p>
            )}
          </div>
        )}

        {data && tab === 'users' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {data.users.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No users found.</p>
            ) : (
              data.users.map((user) => (
                <div key={user.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="text-[11px] text-slate-500">{storeName(user.store_id)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold tracking-wide text-slate-500">{user.role}</span>
                      {!user.is_active && (
                        <p className="text-[10px] text-red-500">Inactive</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
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
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
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

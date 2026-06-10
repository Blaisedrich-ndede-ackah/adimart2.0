import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  TrendingUp, Banknote, CreditCard, Calendar,
  ChevronDown, Receipt
} from 'lucide-react';
import { db, LocalTransaction, LocalTransactionItem, getCurrentStoreTransactions } from '@/lib/dexie';

type Period = 'today' | 'week' | 'month';

interface DayData {
  day: string;
  revenue: number;
  count: number;
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('today');
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [chartData, setChartData] = useState<DayData[]>([]);
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [txnItems, setTxnItems] = useState<Record<string, LocalTransactionItem[]>>({});

  const getDateRange = useCallback((p: Period): { start: Date; end: Date } => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (p) {
      case 'today': {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        return { start, end };
      }
      case 'week': {
        const start = new Date(now);
        start.setDate(now.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        return { start, end };
      }
      case 'month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        return { start, end };
      }
    }
  }, []);

  const loadData = useCallback(async () => {
    const { start, end } = getDateRange(period);

    const allTxns = (await getCurrentStoreTransactions())
      .filter(t => t.status === 'completed');

    const periodTxns = allTxns.filter(t => {
      const d = new Date(t.created_at);
      return d >= start && d <= end;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setTransactions(periodTxns);

    const now = new Date();
    const days: DayData[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

      const dayTxns = allTxns.filter(t => {
        const td = new Date(t.created_at);
        return td >= dayStart && td <= dayEnd;
      });

      days.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        revenue: dayTxns.reduce((s, t) => s + t.total_amount, 0),
        count: dayTxns.length,
      });
    }
    setChartData(days);
  }, [period, getDateRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadTxnItems = async (txnId: string) => {
    if (txnItems[txnId]) {
      setExpandedTxn(expandedTxn === txnId ? null : txnId);
      return;
    }
    const items = await db.transaction_items
      .where('transaction_id').equals(txnId)
      .toArray();
    setTxnItems(prev => ({ ...prev, [txnId]: items }));
    setExpandedTxn(txnId);
  };

  const totalRevenue = transactions.reduce((s, t) => s + t.total_amount, 0);
  const cashRevenue = transactions
    .filter(t => t.payment_method === 'cash')
    .reduce((s, t) => s + t.total_amount, 0);
  const paystackRevenue = transactions
    .filter(t => t.payment_method === 'paystack' || t.payment_method === 'split')
    .reduce((s, t) => s + (t.paystack_amount || 0), 0);
  const totalDiscount = transactions.reduce((s, t) => s + t.discount_applied, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-primary px-4 py-3 flex-shrink-0">
        <h1 className="text-white font-bold text-lg mb-3">Reports & Analytics</h1>

        {/* Period Tabs */}
        <div className="flex bg-white/15 rounded-xl p-0.5">
          {([
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
            { key: 'month', label: 'This Month' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setPeriod(tab.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition touch-target ${
                period === tab.key
                  ? 'bg-white text-primary'
                  : 'text-white/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-20 no-scrollbar">
        {/* Revenue Cards */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 col-span-2">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-xs text-gray-500 font-medium">Total Revenue</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">GH₵{totalRevenue.toFixed(2)}</p>
            <p className="text-xs text-gray-500">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <Banknote className="w-4 h-4 text-green-600" />
              <span className="text-xs text-gray-500 font-medium">Cash</span>
            </div>
            <p className="text-lg font-bold text-gray-900">GH₵{cashRevenue.toFixed(2)}</p>
          </div>

          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-gray-500 font-medium">Paystack</span>
            </div>
            <p className="text-lg font-bold text-gray-900">GH₵{paystackRevenue.toFixed(2)}</p>
          </div>

          {totalDiscount > 0 && (
            <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 col-span-2">
              <span className="text-xs text-gray-500 font-medium">Total Discounts Given</span>
              <p className="text-lg font-bold text-red-500">-GH₵{totalDiscount.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* 7-Day Chart */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            7-Day Revenue
          </h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `₵${v}`} />
                <Tooltip
                  formatter={(value: unknown) => [`GH₵${Number(value).toFixed(2)}`, 'Revenue']}
                  labelStyle={{ fontSize: 12, fontWeight: 'bold' }}
                  contentStyle={{ borderRadius: 12, fontSize: 12 }}
                />
                <Bar dataKey="revenue" fill="#065f46" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Transaction Register */}
        <div className="mb-4">
          <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            Transaction Register
          </h3>

          {transactions.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center text-gray-400">
              <p className="text-sm">No transactions for this period</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map(txn => (
                <div key={txn.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => loadTxnItems(txn.id)}
                    className="w-full p-3 flex items-center justify-between touch-target"
                  >
                    <div className="text-left">
                      <p className="text-xs font-mono font-bold text-primary">{txn.receipt_number}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(txn.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                        {' • '}{txn.cashier_name}
                        {' • '}{txn.payment_method === 'cash' ? '💵' : txn.payment_method === 'paystack' ? '💳' : '↔️'} {txn.payment_method}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">GH₵{txn.total_amount.toFixed(2)}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expandedTxn === txn.id ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {expandedTxn === txn.id && txnItems[txn.id] && (
                    <div className="px-3 pb-3 border-t border-gray-100 pt-2 animate-fade-in">
                      {txnItems[txn.id].map(item => (
                        <div key={item.id} className="flex justify-between py-1 text-xs">
                          <span className="text-gray-600">{item.product_name} × {item.quantity}</span>
                          <span className="text-gray-800 font-medium">GH₵{item.subtotal.toFixed(2)}</span>
                        </div>
                      ))}
                      {txn.discount_applied > 0 && (
                        <div className="flex justify-between py-1 text-xs text-red-500 border-t border-gray-50 mt-1 pt-1">
                          <span>Discount</span>
                          <span>-GH₵{txn.discount_applied.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

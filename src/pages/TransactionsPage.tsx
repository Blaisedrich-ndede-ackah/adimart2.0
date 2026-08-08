import { useCallback, useEffect, useState } from 'react';
import {
  Receipt, Printer, Loader2, ChevronDown, ChevronUp, RefreshCcw, AlertCircle
} from 'lucide-react';
import {
  LocalTransaction,
  LocalTransactionItem,
  getCurrentStoreTransactions,
  getTransactionsForCashier,
  getTransactionItems,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { reprintTransactionReceipt } from '@/lib/receiptReprint';
import { isPrinterConnected } from '@/lib/bluetoothPeripherals';

export default function TransactionsPage() {
  const { currentUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemsByTxn, setItemsByTxn] = useState<Record<string, LocalTransactionItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    const all = isOwner
      ? await getCurrentStoreTransactions()
      : await getTransactionsForCashier(currentUser.id);

    const completed = all
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setTransactions(completed);
    setLoading(false);
  }, [currentUser, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpand = async (txnId: string) => {
    if (expandedId === txnId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(txnId);
    if (!itemsByTxn[txnId]) {
      const items = await getTransactionItems(txnId);
      setItemsByTxn((prev) => ({ ...prev, [txnId]: items }));
    }
  };

  const handleReprint = async (txn: LocalTransaction) => {
    setStatus('');
    if (!isPrinterConnected()) {
      setStatus('No printer connected. Pair one under Devices first.');
      return;
    }
    setPrintingId(txn.id);
    const result = await reprintTransactionReceipt(txn);
    setStatus(
      result.success
        ? `Reprinted ${txn.receipt_number}`
        : result.error || 'Reprint failed'
    );
    setPrintingId(null);
    setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-primary px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-lg">
              {isOwner ? 'Transactions' : 'My Sales'}
            </h1>
            <p className="text-emerald-200 text-xs">
              {isOwner
                ? 'Store sales history — reprint any receipt'
                : 'Your completed sales — reprint receipts'}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="bg-white/20 p-2 rounded-xl touch-target"
            title="Refresh"
          >
            <RefreshCcw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-24 no-scrollbar">
        {status && (
          <div className={`mb-3 rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${
            status.includes('fail') || status.includes('No printer')
              ? 'bg-amber-50 text-amber-800'
              : 'bg-emerald-50 text-emerald-800'
          }`}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {status}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Receipt className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">No completed sales yet</p>
          </div>
        )}

        <div className="space-y-2">
          {transactions.map((txn) => {
            const expanded = expandedId === txn.id;
            const items = itemsByTxn[txn.id] || [];
            return (
              <div key={txn.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  onClick={() => void toggleExpand(txn.id)}
                  className="w-full px-3 py-3 flex items-center gap-3 text-left touch-target"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 font-mono truncate">
                      {txn.receipt_number}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {new Date(txn.created_at).toLocaleString('en-GH')}
                      {isOwner ? ` · ${txn.cashier_name || 'Cashier'}` : ''}
                      {' · '}
                      {txn.payment_method}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">GH₵{txn.total_amount.toFixed(2)}</p>
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
                    )}
                  </div>
                </button>

                {expanded && (
                  <div className="px-3 pb-3 border-t border-gray-50 pt-2 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-xs text-gray-400">Loading items…</p>
                    ) : (
                      items.map((item) => (
                        <div key={item.id} className="flex justify-between text-xs text-gray-700">
                          <span className="truncate pr-2">
                            {item.quantity}× {item.product_name}
                          </span>
                          <span className="font-medium flex-shrink-0">GH₵{item.subtotal.toFixed(2)}</span>
                        </div>
                      ))
                    )}
                    {txn.discount_applied > 0 && (
                      <p className="text-xs text-red-500">Discount: -GH₵{txn.discount_applied.toFixed(2)}</p>
                    )}
                    <button
                      onClick={() => void handleReprint(txn)}
                      disabled={printingId === txn.id}
                      className="w-full mt-1 py-2.5 bg-primary/10 text-primary rounded-xl text-xs font-semibold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                    >
                      {printingId === txn.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Printer className="w-4 h-4" />
                      )}
                      Reprint receipt
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

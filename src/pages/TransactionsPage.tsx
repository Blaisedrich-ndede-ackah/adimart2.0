import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Receipt, Printer, Loader2, RefreshCcw, AlertCircle, Eye, X, Search, FileText
} from 'lucide-react';
import {
  LocalTransaction,
  LocalTransactionItem,
  LocalCreditPayment,
  getCurrentStoreTransactions,
  getTransactionsForCashier,
  getTransactionItems,
  getCreditPaymentsForTransaction,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { reprintTransactionReceipt } from '@/lib/receiptReprint';
import { isPrinterConnected } from '@/lib/bluetoothPeripherals';
import { openComputerPrinterWindow } from '@/lib/printService';
import { parseOtherCharges } from '@/lib/otherCharges';
import { getPaymentMethodLabel } from '@/lib/paymentMethods';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import CloudSyncPanel from '@/components/CloudSyncPanel';

type Period = 'today' | 'week' | 'all';

const PERIODS: Period[] = ['all', 'today', 'week'];

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function startOfWeek(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
}

export default function TransactionsPage() {
  const { currentUser, currentStore } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const isOwner = currentUser?.role === 'owner';
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [itemsByTxn, setItemsByTxn] = useState<Record<string, LocalTransactionItem[]>>({});
  const [creditPaymentsByTxn, setCreditPaymentsByTxn] = useState<Record<string, LocalCreditPayment[]>>({});
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'ok' | 'error'>('ok');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  const ensureDetails = useCallback(
    async (txnId: string) => {
      if (itemsByTxn[txnId]) return;
      const [items, payments] = await Promise.all([
        getTransactionItems(txnId),
        getCreditPaymentsForTransaction(txnId),
      ]);
      setItemsByTxn((prev) => ({ ...prev, [txnId]: items }));
      setCreditPaymentsByTxn((prev) => ({ ...prev, [txnId]: payments }));
    },
    [itemsByTxn]
  );

  const openPreview = useCallback(
    async (txn: LocalTransaction) => {
      setPreviewId(txn.id);
      setPreviewLoading(true);
      await ensureDetails(txn.id);
      setPreviewLoading(false);
    },
    [ensureDetails]
  );

  const closePreview = () => {
    setPreviewId(null);
    setPreviewLoading(false);
  };

  const handlePrint = useCallback(async (txn: LocalTransaction) => {
    setStatus('');
    setStatusTone('ok');
    const printWindow = isPrinterConnected() ? undefined : openComputerPrinterWindow();
    setPrintingId(txn.id);
    const printResult = await reprintTransactionReceipt(txn, printWindow);
    if (printResult.success) {
      setStatus(`${t('sales.printedOk')} · ${txn.receipt_number}`);
      setStatusTone('ok');
    } else {
      setStatus(printResult.error || t('sales.printFailed'));
      setStatusTone('error');
    }
    setPrintingId(null);
    setTimeout(() => setStatus(''), 4000);
  }, [t]);

  const periodFiltered = useMemo(() => {
    if (period === 'all') return transactions;
    const floor = period === 'today' ? startOfToday() : startOfWeek();
    return transactions.filter(
      (txn) => new Date(txn.created_at).getTime() >= floor
    );
  }, [transactions, period]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return periodFiltered;
    return periodFiltered.filter(
      (txn) =>
        txn.receipt_number.toLowerCase().includes(needle) ||
        (txn.cashier_name || '').toLowerCase().includes(needle) ||
        (txn.customer_name || '').toLowerCase().includes(needle)
    );
  }, [periodFiltered, search]);

  const periodTotal = useMemo(
    () => periodFiltered.reduce((sum, txn) => sum + (txn.total_amount || 0), 0),
    [periodFiltered]
  );

  const previewTxn = previewId
    ? transactions.find((txn) => txn.id === previewId) || null
    : null;
  const previewItems = previewId ? itemsByTxn[previewId] || [] : [];
  const previewPayments = previewId ? creditPaymentsByTxn[previewId] || [] : [];
  const previewCharges = previewTxn ? parseOtherCharges(previewTxn.other_charges_json) : [];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-white font-bold text-lg truncate">
              {isOwner ? t('sales.recordsTitle') : t('sales.myTitle')}
            </h1>
            <p className="text-emerald-200 text-xs truncate">
              {isOwner ? t('sales.recordsSubtitle') : 'Your completed sales — reprint receipts'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="bg-white/20 p-2 rounded-xl touch-target"
            title="Refresh"
          >
            <RefreshCcw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="page-body no-scrollbar">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
            <p className="text-[11px] text-gray-500">{t('sales.receipts')}</p>
            <p className="text-lg font-bold text-gray-900">{periodFiltered.length}</p>
          </div>
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
            <p className="text-[11px] text-gray-500">{t('sales.totalSales')}</p>
            <p className="text-lg font-bold text-primary truncate">{money(periodTotal)}</p>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-xl bg-white border border-gray-100 shadow-sm px-3">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sales.searchPlaceholder')}
            className="w-full bg-transparent py-2.5 text-sm outline-none"
          />
        </div>

        <div className="mb-3 flex gap-2" role="tablist" aria-label="Sales period">
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={period === option}
              onClick={() => setPeriod(option)}
              className={`flex-1 rounded-xl px-2 py-2 text-xs font-semibold touch-target transition-colors ${
                period === option
                  ? 'bg-primary text-white'
                  : 'bg-white border border-gray-100 text-gray-600 shadow-sm'
              }`}
            >
              {option === 'all'
                ? t('sales.allTime')
                : option === 'today'
                  ? t('sales.today')
                  : t('sales.last7')}
            </button>
          ))}
        </div>

        {!isOwner && (
          <CloudSyncPanel hint={t('sync.cashierHint')} onSynced={() => void load()} />
        )}

        {status && (
          <div className={`mb-3 rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${
            statusTone === 'error'
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

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Receipt className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">{t('sales.noSales')}</p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((txn) => {
            const isPrinting = printingId === txn.id;
            return (
              <div key={txn.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => void openPreview(txn)}
                  className="w-full px-3 py-3 flex items-center gap-3 text-left touch-target"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 font-mono truncate">
                      {txn.receipt_number}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {new Date(txn.created_at).toLocaleString('en-GH')}
                      {isOwner ? ` · ${txn.cashier_name || 'Cashier'}` : ''}
                      {' · '}
                      {getPaymentMethodLabel(txn.payment_method)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{money(txn.total_amount)}</p>
                    <p className="text-[10px] text-gray-400">{t('sales.viewReceipt')}</p>
                  </div>
                </button>

                <div className="flex items-center gap-2 border-t border-gray-50 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void openPreview(txn)}
                    className="flex-1 py-2 rounded-xl bg-surface-muted text-gray-700 text-xs font-semibold flex items-center justify-center gap-2 touch-target"
                  >
                    <Eye className="w-4 h-4" />
                    {t('sales.viewReceipt')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePrint(txn)}
                    disabled={isPrinting}
                    className="flex-1 py-2 bg-primary/10 text-primary rounded-xl text-xs font-semibold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                  >
                    {isPrinting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Printer className="w-4 h-4" />
                    )}
                    {t('sales.printReceipt')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {previewTxn && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50"
            aria-label={t('common.close')}
            onClick={closePreview}
          />
          <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-surface-card shadow-2xl animate-slide-up">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-muted bg-surface-card px-4 py-3 rounded-t-3xl">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                    {t('sales.viewReceipt')}
                  </p>
                  <p className="truncate text-sm font-bold text-ink font-mono">
                    {previewTxn.receipt_number}
                  </p>
                </div>
              </div>
              <button type="button" onClick={closePreview} className="icon-btn" aria-label={t('common.close')}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              <div className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-gray-600 space-y-1">
                <p className="flex justify-between gap-3">
                  <span>{t('common.store')}</span>
                  <span className="font-semibold text-gray-900">{currentStore?.name || 'Store'}</span>
                </p>
                <p className="flex justify-between gap-3">
                  <span>Date</span>
                  <span className="font-semibold text-gray-900">
                    {new Date(previewTxn.created_at).toLocaleString('en-GH')}
                  </span>
                </p>
                <p className="flex justify-between gap-3">
                  <span>Cashier</span>
                  <span className="font-semibold text-gray-900">{previewTxn.cashier_name || 'Cashier'}</span>
                </p>
                <p className="flex justify-between gap-3">
                  <span>Payment</span>
                  <span className="font-semibold text-gray-900">
                    {getPaymentMethodLabel(previewTxn.payment_method)}
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 px-3 py-2">
                {previewLoading && (
                  <p className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading items…
                  </p>
                )}
                {!previewLoading && previewItems.length === 0 && (
                  <p className="py-4 text-center text-xs text-gray-400">No items on this receipt.</p>
                )}
                {!previewLoading && previewItems.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3 py-1.5 text-xs text-gray-700 border-b border-gray-50 last:border-0">
                    <span className="min-w-0">
                      <span className="font-semibold text-gray-900">{item.quantity}×</span>{' '}
                      <span className="break-words">{item.product_name}</span>
                      <span className="block text-[10px] text-gray-400">
                        {money(item.unit_price)} each
                      </span>
                    </span>
                    <span className="font-semibold flex-shrink-0">{money(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-surface-muted px-3 py-2 text-xs space-y-1">
                <p className="flex justify-between gap-3 text-gray-600">
                  <span>Subtotal</span>
                  <span>
                    {money(
                      previewItems.reduce((sum, item) => sum + (item.subtotal || 0), 0)
                    )}
                  </span>
                </p>
                {previewTxn.discount_applied > 0 && (
                  <p className="flex justify-between gap-3 text-red-500">
                    <span>Discount</span>
                    <span>-{money(previewTxn.discount_applied)}</span>
                  </p>
                )}
                {previewCharges.map((charge) => (
                  <p key={charge.id} className="flex justify-between gap-3 text-gray-600">
                    <span>{charge.label}</span>
                    <span>{money(charge.amount)}</span>
                  </p>
                ))}
                <p className="flex justify-between gap-3 text-sm font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                  <span>Total</span>
                  <span>{money(previewTxn.total_amount)}</span>
                </p>
              </div>

              {previewTxn.payment_method === 'credit' && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 space-y-1.5">
                  <p className="text-xs text-amber-900">
                    Customer: <span className="font-semibold">{previewTxn.customer_name || 'Not recorded'}</span>
                    {previewTxn.customer_phone ? ` · ${previewTxn.customer_phone}` : ''}
                  </p>
                  <p className="text-xs text-amber-900">
                    Outstanding balance:{' '}
                    <span className="font-bold">{money(previewTxn.credit_balance || 0)}</span>
                  </p>
                  {previewPayments.map((payment) => (
                    <p key={payment.id} className="text-[11px] text-amber-800">
                      Payment {money(payment.amount)} · {new Date(payment.created_at).toLocaleString('en-GH')}
                      {payment.created_by ? ` · ${payment.created_by}` : ''}
                    </p>
                  ))}
                </div>
              )}

              {(previewTxn.payment_reference || previewTxn.paystack_reference) && (
                <p className="text-xs text-gray-600">
                  Payment reference:{' '}
                  <span className="font-mono">{previewTxn.payment_reference || previewTxn.paystack_reference}</span>
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handlePrint(previewTxn)}
                  disabled={printingId === previewTxn.id}
                  className="flex-1 py-3 bg-primary text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                >
                  {printingId === previewTxn.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                  {t('sales.printReceipt')}
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="px-4 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold touch-target"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, CheckCircle2, CircleAlert, LoaderCircle, PackageCheck, Printer, Search, X } from 'lucide-react';
import { db, type LocalOnlineOrder, type LocalOnlineOrderItem, type LocalStore } from '@/lib/dexie';
import { listLocalOnlineOrderItems, pullOnlineOrdersFromCloud, updateOnlineOrderStatus, verifyPriceScanPayment } from '@/lib/ecommerce';
import { printReceipt } from '@/lib/printService';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';

interface PickupOrder extends LocalOnlineOrder {
  items: LocalOnlineOrderItem[];
}

interface PriceScanPickupDeskProps {
  open: boolean;
  onClose: () => void;
  store: LocalStore;
  cashierName: string;
  cashierId: string;
}

export default function PriceScanPickupDesk({ open, onClose, store, cashierName, cashierId }: PriceScanPickupDeskProps) {
  const t = useT();
  const money = useFormatMoney();
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<PickupOrder | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [paymentVerification, setPaymentVerification] = useState<'idle' | 'checking' | 'verified' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const total = Math.max(0, Number(order?.total_amount) || 0);
  const allItemsChecked = Boolean(order?.items.length) && order?.items.every((item) => checkedItems.has(item.id));
  const needsOnlineVerification = order?.payment_method === 'paystack';
  const paidOnline = needsOnlineVerification && paymentVerification === 'verified';
  const isPaid = paidOnline;
  const canComplete = Boolean(order && allItemsChecked && isPaid && order.status !== 'fulfilled' && order.status !== 'cancelled');
  const inspectedCount = useMemo(() => checkedItems.size, [checkedItems]);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setOrder(null);
    setCheckedItems(new Set());
    setPaymentVerification('idle');
    setError('');
    setMessage('');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const findOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedCode = code.trim().toUpperCase();
    if (!requestedCode) return;
    if (!requestedCode.startsWith('PS-')) {
      setError(t('pickup.priceScanCodeOnly'));
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    setOrder(null);
    setCheckedItems(new Set());
    setPaymentVerification('idle');
    try {
      if (navigator.onLine !== false) {
        try {
          await pullOnlineOrdersFromCloud(store.id);
        } catch {
          // Continue with the local queue if the cloud is unavailable.
        }
      }
      const found = await db.online_orders
        .where('store_id')
        .equals(store.id)
        .filter((row) => row.order_number.trim().toUpperCase() === requestedCode)
        .first();
      if (!found) {
        setError(t('pickup.orderNotFound'));
        return;
      }
      if (found.payment_method !== 'paystack') {
        setError(t('pickup.paystackOnly'));
        return;
      }
      const items = await listLocalOnlineOrderItems(store.id, found.id);
      if (items.length === 0) {
        setError(t('pickup.itemsUnavailable'));
        return;
      }
      setOrder({ ...found, items });
      await verifyOnlinePayment(found);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('pickup.lookupFailed'));
    } finally {
      setBusy(false);
    }
  };

  async function verifyOnlinePayment(found: LocalOnlineOrder): Promise<void> {
    setPaymentVerification('checking');
    setError('');
    try {
      const verified = await verifyPriceScanPayment(store.id, found.id);
      setPaymentVerification(verified ? 'verified' : 'failed');
      if (!verified) setError(t('pickup.onlinePaymentUnverified'));
    } catch {
      setPaymentVerification('failed');
      setError(t('pickup.onlinePaymentCheckFailed'));
    }
  }

  const retryOnlinePaymentVerification = async () => {
    if (!order || !needsOnlineVerification) return;
    setBusy(true);
    try {
      await verifyOnlinePayment(order);
    } finally {
      setBusy(false);
    }
  };

  const completePickup = async () => {
    if (!order || !canComplete) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateOnlineOrderStatus(order.id, 'fulfilled', cashierId, cashierName);
      const updated = await db.online_orders.get(order.id);
      if (updated) setOrder((current) => current ? { ...current, ...updated } : current);
      setMessage(t('pickup.completed'));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('pickup.completeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const printPickupReceipt = async () => {
    if (!order) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await printReceipt({
        storeName: store.name,
        storeAddress: store.address || '',
        supportNumber: store.support_number || '',
        storeLogoUrl: store.logo_url || undefined,
        receiptNumber: order.order_number,
        cashierName,
        dateTime: new Date().toISOString(),
        items: order.items.map((item) => ({
          name: item.product_name,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unit_price) || 0,
          subtotal: Number(item.subtotal) || 0,
        })),
        subtotal: total,
        discount: 0,
        total,
        paymentMethod: order.payment_method,
        cashAmount: 0,
        paystackAmount: paidOnline ? total : 0,
        paymentReference: paidOnline ? order.notes.replace(/^price-scan-paystack:/, '') : undefined,
        currencyCode: store.currency_code || 'GHS',
      });
      if (!result.success) throw new Error(result.error || t('pickup.printFailed'));
      setMessage(t('pickup.receiptPrinted'));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('pickup.printFailed'));
    } finally {
      setBusy(false);
    }
  };

  const toggleInspected = (itemId: string) => {
    setCheckedItems((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const resetDesk = () => {
    if (busy) return;
    setCode('');
    setOrder(null);
    setCheckedItems(new Set());
    setPaymentVerification('idle');
    setError('');
    setMessage('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={(event) => { if (event.target === event.currentTarget && !busy) resetDesk(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="pickup-title" className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-slate-50 shadow-2xl sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-primary"><PackageCheck className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="pickup-title" className="font-bold text-gray-950">{t('pickup.title')}</h2>
            <p className="text-xs text-gray-500">{t('pickup.subtitle')}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={resetDesk} disabled={busy} aria-label={t('common.close')} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 touch-target disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          <form onSubmit={(event) => void findOrder(event)} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <label htmlFor="pickup-code" className="mb-2 block text-sm font-semibold text-gray-800">{t('pickup.enterCode')}</label>
            <div className="flex gap-2">
              <input id="pickup-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="PS-…" autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-3 font-mono text-lg font-bold uppercase tracking-wider outline-none focus:border-primary focus:ring-2 focus:ring-emerald-100" />
              <button type="submit" disabled={busy || !code.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white touch-target disabled:opacity-50">
                {busy && !order ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{t('pickup.findOrder')}
              </button>
            </div>
          </form>

          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</p>}

          {order && (
            <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('pickup.code')}</p>
                  <p className="mt-1 font-mono text-xl font-extrabold text-gray-950">{order.order_number}</p>
                  <p className="mt-1 text-xs text-gray-500">{new Date(order.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-extrabold text-primary">{money(total)}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wide text-gray-500">{t(`pickup.status.${order.status}`)}</p>
                </div>
              </div>

              <div className={`flex items-start gap-3 p-4 ${isPaid ? 'bg-emerald-50' : needsOnlineVerification ? 'bg-sky-50' : 'bg-amber-50'}`}>
                {isPaid
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  : needsOnlineVerification && paymentVerification === 'checking'
                    ? <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-700" />
                    : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />}
                <div>
                  <p className={`font-bold ${isPaid ? 'text-emerald-900' : needsOnlineVerification ? 'text-sky-950' : 'text-amber-950'}`}>
                    {isPaid
                      ? t('pickup.paidOnline')
                      : t(paymentVerification === 'checking' ? 'pickup.verifyingOnline' : 'pickup.onlinePaymentUnverified')}
                  </p>
                  <p className={`mt-0.5 text-xs ${isPaid ? 'text-emerald-800' : needsOnlineVerification ? 'text-sky-800' : 'text-amber-800'}`}>
                    {isPaid ? t('pickup.paymentConfirmedHint') : t('pickup.onlinePaymentVerifyHint')}
                  </p>
                </div>
              </div>
              {needsOnlineVerification && paymentVerification === 'failed' && (
                <div className="px-4 pt-3">
                  <button type="button" onClick={() => void retryOnlinePaymentVerification()} disabled={busy} className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-900 touch-target disabled:opacity-50">{t('pickup.retryVerification')}</button>
                </div>
              )}

              <div className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">{t('pickup.inspectItems')}</h3>
                  <span className="text-xs font-medium text-gray-500">{t('pickup.checkedCount', { checked: inspectedCount, total: order.items.length })}</span>
                </div>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                  {order.items.map((item) => {
                    const inspected = checkedItems.has(item.id);
                    return (
                      <li key={item.id}>
                        <label className={`flex cursor-pointer items-center gap-3 p-3 ${inspected ? 'bg-emerald-50/70' : ''}`}>
                          <input type="checkbox" checked={inspected} onChange={() => toggleInspected(item.id)} disabled={order.status === 'fulfilled' || order.status === 'cancelled'} className="h-5 w-5 shrink-0 accent-emerald-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-semibold text-gray-900">{item.product_name}</span>
                            <span className="text-xs text-gray-500">{item.quantity} × {money(Number(item.unit_price) || 0)}</span>
                          </span>
                          <span className="shrink-0 text-sm font-bold text-gray-800">{money(Number(item.subtotal) || 0)}</span>
                          {inspected && <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {order.status !== 'fulfilled' && order.status !== 'cancelled' ? (
                <div className="border-t border-gray-100 p-4">
                  <button type="button" onClick={() => void completePickup()} disabled={busy || !canComplete} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-md touch-target disabled:cursor-not-allowed disabled:bg-gray-300">
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-5 w-5" />}{t('pickup.completePickup')}
                  </button>
                  {(!allItemsChecked || !isPaid) && <p className="mt-2 text-center text-xs text-gray-500">{t('pickup.completeRequirements')}</p>}
                </div>
              ) : null}

              {order.status === 'fulfilled' && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-900">{t('pickup.fulfilled')}</p>
                  <button type="button" onClick={() => void printPickupReceipt()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary shadow-sm touch-target disabled:opacity-50">
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}{t('pickup.printReceipt')}
                  </button>
                </div>
              )}
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

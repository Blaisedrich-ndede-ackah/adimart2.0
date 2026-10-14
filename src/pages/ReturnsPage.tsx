import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Camera, Loader2, RotateCcw } from 'lucide-react';
import {
  db,
  type LocalCustomer,
  getCurrentStoreId,
  getCurrentStoreTransactions,
  type LocalSaleReturn,
  type LocalTransaction,
  type LocalTransactionItem,
} from '@/lib/dexie';
import { processSaleReturn } from '@/lib/warehouse';
import { fileToProductImageDataUrl } from '@/lib/productImage';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { triggerPushSync } from '@/lib/sync';

export default function ReturnsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const money = useFormatMoney();
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [transactionItems, setTransactionItems] = useState<LocalTransactionItem[]>([]);
  const [returns, setReturns] = useState<LocalSaleReturn[]>([]);
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'wallet' | 'account'>('cash');
  const [refundCustomerId, setRefundCustomerId] = useState('');
  const [refundCustomerName, setRefundCustomerName] = useState('');
  const [refundCustomerPhone, setRefundCustomerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [allTransactions, storeId] = await Promise.all([
        getCurrentStoreTransactions(),
        getCurrentStoreId(),
      ]);
      if (!storeId) throw new Error('No store selected.');
      const [allReturns, allItems, allCustomers] = await Promise.all([
        db.sales_returns.where('store_id').equals(storeId).toArray(),
        db.transaction_items.where('store_id').equals(storeId).toArray(),
        db.customers.where('store_id').equals(storeId).toArray(),
      ]);
      const completedTransactions = allTransactions
        .filter((transaction) => transaction.status === 'completed')
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const transactionIds = new Set(completedTransactions.map((transaction) => transaction.id));
      setTransactions(completedTransactions);
      setReturns(allReturns.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setTransactionItems(allItems);
      setCustomers(allCustomers);
      if (selectedTransactionId && !transactionIds.has(selectedTransactionId)) {
        setSelectedTransactionId('');
        setSelectedItemId('');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load sales and returns.');
    } finally {
      setLoading(false);
    }
  }, [selectedTransactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedTransaction = transactions.find((transaction) => transaction.id === selectedTransactionId);
  const itemsForSale = transactionItems.filter((item) => item.transaction_id === selectedTransactionId);
  const selectedItem = itemsForSale.find((item) => item.id === selectedItemId);
  const selectedCustomer = customers.find((customer) => customer.id === refundCustomerId);
  const returnQuantity = Number(quantity) || 0;
  const saleItemSubtotal = transactionItems
    .filter((item) => item.transaction_id === selectedTransactionId)
    .reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const grossReturnAmount = selectedItem ? selectedItem.unit_price * returnQuantity : 0;
  const discountShare = selectedItem && selectedTransaction && saleItemSubtotal > 0
    ? Math.min(
        grossReturnAmount,
        selectedTransaction.discount_applied *
          (selectedItem.subtotal / saleItemSubtotal) *
          (returnQuantity / selectedItem.quantity)
      )
    : 0;
  const estimatedRefund = Math.max(0, grossReturnAmount - discountShare);

  const returnedByItem = useMemo(() => {
    const totals = new Map<string, number>();
    for (const saleReturn of returns) {
      totals.set(
        saleReturn.transaction_item_id,
        (totals.get(saleReturn.transaction_item_id) || 0) + saleReturn.quantity
      );
    }
    return totals;
  }, [returns]);

  const onPhotoChange = async (file?: File) => {
    setError('');
    if (!file) {
      setPhoto('');
      return;
    }
    try {
      setPhoto(await fileToProductImageDataUrl(file));
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Could not process the return photo.');
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!currentStore?.id || !currentUser?.id || !selectedTransaction || !selectedItem) {
      setError('Select the original sale and item to return.');
      return;
    }
    const returnQty = Number(quantity);
    const alreadyReturned = returnedByItem.get(selectedItem.id) || 0;
    if (!Number.isFinite(returnQty) || returnQty <= 0 || returnQty > selectedItem.quantity - alreadyReturned) {
      setError(`Enter a quantity up to ${selectedItem.quantity - alreadyReturned}.`);
      return;
    }
    if (refundMethod !== 'cash' && !refundCustomerId && !refundCustomerName.trim() &&
      !(selectedTransaction.customer_name || '').trim()) {
      setError('Enter the customer name to create their store-credit account.');
      return;
    }
    const outcomeText = refundMethod === 'cash'
      ? `refund ${money(estimatedRefund)} in cash`
      : refundMethod === 'wallet'
        ? `add ${money(estimatedRefund)} to the customer wallet`
        : `apply ${money(estimatedRefund)} to the customer account; any amount above their debt becomes wallet credit`;
    if (!confirm(`This will restock the item and ${outcomeText}. Continue?`)) {
      return;
    }

    setBusy(true);
    try {
      const record = await processSaleReturn({
        storeId: currentStore.id,
        userId: currentUser.id,
        transactionId: selectedTransaction.id,
        transactionItemId: selectedItem.id,
        quantity: returnQty,
        reason,
        photoDataUrl: photo,
        refundMethod,
        customerId: refundCustomerId || undefined,
        customerName: refundCustomerName || selectedTransaction.customer_name || '',
        customerPhone: refundCustomerPhone || selectedTransaction.customer_phone || '',
      });
      const refundSummary = record.refund_method === 'cash'
        ? `Cash refund ${money(record.refund_amount)}`
        : record.refund_method === 'wallet'
          ? `Wallet credit ${money(record.wallet_credit)}`
          : `Debt reduced ${money(record.debt_applied)}${record.wallet_credit > 0 ? ` · wallet credit ${money(record.wallet_credit)}` : ''}`;
      setMessage(`${record.product_name} return recorded; ${record.stock_quantity} inventory unit(s) restocked. ${refundSummary}.`);
      setSelectedItemId('');
      setQuantity('1');
      setReason('');
      setPhoto('');
      setRefundCustomerId('');
      setRefundCustomerName('');
      setRefundCustomerPhone('');
      await load();
      void triggerPushSync('sale-return');
    } catch (returnError) {
      setError(returnError instanceof Error ? returnError.message : 'Could not process the return.');
    } finally {
      setBusy(false);
    }
  };

  const formatMethod = (transaction: LocalTransaction) =>
    transaction.payment_method === 'credit' ? 'Credit sale' : transaction.payment_method;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="text-white font-bold text-lg">Returns management</h1>
        <p className="text-emerald-200 text-xs">Process a sold item return and automatically restock inventory.</p>
      </div>
      <div className="page-content space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div>
            <h2 className="font-semibold text-gray-900">Record a returned item</h2>
            <p className="mt-1 text-xs text-gray-500">Only items on the selected sale can be returned. Returned quantities are automatically restocked.</p>
          </div>
          <label className="block text-sm text-gray-700">
            Original sale / receipt *
            <select
              required
              value={selectedTransactionId}
              onChange={(event) => {
                const id = event.target.value;
                const transaction = transactions.find((item) => item.id === id);
                const match = customers.find((customer) =>
                  transaction?.customer_id
                    ? customer.id === transaction.customer_id
                    : customer.name.trim().toLowerCase() === (transaction?.customer_name || '').trim().toLowerCase() &&
                      customer.phone.trim() === (transaction?.customer_phone || '').trim()
                );
                setSelectedTransactionId(id);
                setSelectedItemId('');
                setRefundCustomerId(match?.id || '');
                setRefundCustomerName(transaction?.customer_name || '');
                setRefundCustomerPhone(transaction?.customer_phone || '');
              }}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
            >
              <option value="">Select a receipt</option>
              {transactions.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {transaction.receipt_number} · {new Date(transaction.created_at).toLocaleDateString()} · {money(transaction.total_amount)} · {formatMethod(transaction)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700">Refund or account adjustment *</legend>
            {([
              ['cash', 'Refund in cash'],
              ['wallet', 'Add store credit to customer wallet'],
              ['account', 'Deduct from customer balance'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
                <input
                  type="radio"
                  name="refund-method"
                  value={value}
                  checked={refundMethod === value}
                  onChange={() => setRefundMethod(value)}
                  className="mt-0.5 accent-primary"
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          {refundMethod !== 'cash' && (
            <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50 p-3">
              <p className="text-xs text-teal-900">
                {refundMethod === 'account'
                  ? 'Return value reduces the customer’s oldest debt first. Any remainder is added to their wallet.'
                  : 'If the sale has no registered customer, one will be created from the original sale details below.'}
              </p>
              <label className="block text-sm text-gray-700">
                Registered customer (optional if creating from sale)
                <select
                  value={refundCustomerId}
                  onChange={(event) => {
                    const customer = customers.find((item) => item.id === event.target.value);
                    setRefundCustomerId(event.target.value);
                    if (customer) {
                      setRefundCustomerName(customer.name);
                      setRefundCustomerPhone(customer.phone);
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                >
                  <option value="">Create/link from original sale details</option>
                  {customers.filter((customer) => customer.is_active === 1).map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>
                  ))}
                </select>
              </label>
              {!refundCustomerId && (
                <>
                  <label className="block text-sm text-gray-700">
                    Customer name *
                    <input
                      required
                      maxLength={255}
                      value={refundCustomerName}
                      onChange={(event) => setRefundCustomerName(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Customer phone
                    <input
                      type="tel"
                      maxLength={30}
                      value={refundCustomerPhone}
                      onChange={(event) => setRefundCustomerPhone(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5"
                    />
                  </label>
                </>
              )}
              {selectedCustomer && (
                <p className="text-xs text-gray-600">
                  Current wallet balance: {money(selectedCustomer.wallet_balance || 0)}
                </p>
              )}
            </div>
          )}
          <label className="block text-sm text-gray-700">
            Item returned *
            <select
              required
              value={selectedItemId}
              onChange={(event) => setSelectedItemId(event.target.value)}
              disabled={!selectedTransaction}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 disabled:bg-gray-100"
            >
              <option value="">Select a sold item</option>
              {itemsForSale.map((item) => {
                const remaining = Math.max(0, item.quantity - (returnedByItem.get(item.id) || 0));
                return (
                  <option key={item.id} value={item.id} disabled={remaining <= 0}>
                    {item.product_name} · sold {item.quantity}, returnable {remaining}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedItem && (
            <label className="block text-sm text-gray-700">
              Quantity returned *
              <input
                required
                type="number"
                min="1"
                max={Math.max(0, selectedItem.quantity - (returnedByItem.get(selectedItem.id) || 0))}
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
              />
            </label>
          )}
          {selectedItem && (
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Estimated return value</span>
                <strong>{money(estimatedRefund)}</strong>
              </div>
              {Number(selectedTransaction?.discount_applied) > 0 && (
                <p className="mt-1 text-xs text-gray-500">Original sale discount is deducted proportionally.</p>
              )}
            </div>
          )}
          <label className="block text-sm text-gray-700">
            Return reason *
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-700">
            <Camera className="h-5 w-5 text-gray-500" />
            <span className="min-w-0 flex-1">
              {photo ? 'Product or receipt photo attached' : 'Attach product or original receipt photo (optional)'}
              <span className="mt-0.5 block text-xs text-gray-500">You can capture a photo or select an existing image.</span>
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => { void onPhotoChange(event.target.files?.[0]); event.target.value = ''; }}
              className="sr-only"
            />
          </label>
          {photo && (
            <div className="flex items-start gap-3">
              <img src={photo} alt="Return attachment preview" className="h-20 w-20 rounded-lg border object-cover" />
              <button type="button" onClick={() => setPhoto('')} className="text-xs font-semibold text-red-700">Remove photo</button>
            </div>
          )}
          <button
            type="submit"
            disabled={busy || loading || !selectedItem}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {busy ? 'Processing return…' : 'Restock returned item'}
          </button>
        </form>

        <section className="space-y-3">
          <h2 className="font-semibold text-gray-900">Return history</h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : returns.length === 0 ? (
            <p className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-500">No returns have been recorded.</p>
          ) : returns.map((record) => (
            <article key={record.id} className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
              {record.photo_data_url && (
                <img src={record.photo_data_url} alt={`Attachment for ${record.product_name} return`} className="h-16 w-16 rounded-lg border object-cover" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-gray-900">{record.product_name} · qty {record.quantity}</p>
                <p className="text-xs text-gray-500">{record.receipt_number} · {new Date(record.created_at).toLocaleString()}</p>
                <p className="mt-1 text-xs text-gray-700">{record.reason}</p>
                <p className="mt-1 text-xs font-medium text-emerald-800">Restocked {record.stock_quantity} inventory unit(s)</p>
                <p className="mt-1 text-xs text-gray-600">
                  {record.refund_method === 'cash'
                    ? `Cash refund: ${money(record.refund_amount)}`
                    : record.refund_method === 'wallet'
                      ? `Wallet credit: ${money(record.wallet_credit)}`
                      : record.refund_method === 'account'
                        ? `Debt deducted: ${money(record.debt_applied)}${record.wallet_credit > 0 ? ` · wallet credit: ${money(record.wallet_credit)}` : ''}`
                        : 'Restock only (legacy record)'}
                </p>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

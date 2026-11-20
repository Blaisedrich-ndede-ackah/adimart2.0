import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { db, type LocalSupplier, type LocalSupplierPayment } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { triggerPushSync } from '@/lib/sync';
import {
  listSupplierPayables,
  recordSupplierPayment,
  setPurchaseOrderDueDate,
  type SupplierPayable,
  type SupplierPayMethod,
} from '@/lib/supplierPayments';

export default function SupplierPayablesPanel() {
  const store = useAuthStore((state) => state.currentStore);
  const user = useAuthStore((state) => state.currentUser);
  const money = useFormatMoney();
  const [payables, setPayables] = useState<SupplierPayable[]>([]);
  const [payments, setPayments] = useState<LocalSupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<LocalSupplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SupplierPayMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!store?.id) return;
    const [rows, paid, people] = await Promise.all([
      listSupplierPayables(store.id),
      db.supplier_payments.where('store_id').equals(store.id).reverse().sortBy('paid_at'),
      db.suppliers.where('store_id').equals(store.id).toArray(),
    ]);
    setPayables(rows);
    setPayments(paid);
    setSuppliers(people.filter((supplier) => supplier.is_active === 1));
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const open = payables.filter((row) => row.order.status !== 'cancelled');
    const bySupplier = new Map<string, { name: string; owed: number; overdue: number }>();
    for (const row of open) {
      const current = bySupplier.get(row.order.supplier_id) || { name: row.supplierName, owed: 0, overdue: 0 };
      current.owed += row.balance;
      if (row.overdue) current.overdue += row.balance;
      bySupplier.set(row.order.supplier_id, current);
    }
    return [...bySupplier.entries()].map(([id, value]) => ({ id, ...value }));
  }, [payables]);

  const statement = payables.filter((row) => !supplierId || row.order.supplier_id === supplierId);
  const statementPayments = payments.filter((row) => !supplierId || row.supplier_id === supplierId);

  const pay = async () => {
    if (!store?.id || !user) return;
    setError('');
    try {
      await recordSupplierPayment({
        storeId: store.id,
        supplierId,
        purchaseOrderId: orderId || null,
        amount: Number(amount),
        method,
        note,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        storeName: store.name,
      });
      setAmount('');
      setNote('');
      await load();
      void triggerPushSync('supplier-payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment.');
    }
  };

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="font-bold">Supplier payments</h2>
      </div>
      <p className="text-xs text-gray-600">
        Balance owed is the cost of stock already received, minus payments. Overdue means the due date has passed and a balance remains.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {totals.map((row) => (
          <button key={row.id} type="button" onClick={() => setSupplierId(row.id)} className="rounded-xl bg-white/70 p-3 text-left">
            <p className="text-sm font-semibold">{row.name}</p>
            <p className="text-xs text-gray-600">Owed {money(row.owed)}</p>
            {row.overdue > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> Overdue {money(row.overdue)}
              </p>
            )}
          </button>
        ))}
        {totals.length === 0 && <p className="text-sm text-gray-500">No supplier balances yet.</p>}
      </div>

      <div className="space-y-2">
        {statement.filter((row) => row.order.status !== 'cancelled').map((row) => (
          <div key={row.order.id} className="rounded-xl bg-white/75 p-3 text-sm">
            <div className="flex justify-between gap-2">
              <p className="font-semibold">{row.order.order_number} · {row.supplierName}</p>
              {row.overdue && <span className="text-xs font-semibold text-amber-800">Overdue</span>}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Received {money(row.receivedValue)} · Paid {money(row.amountPaid)} · Balance {money(row.balance)}
            </p>
            <label className="mt-2 block text-xs text-gray-600">
              Due date
              <input
                type="date"
                value={row.dueDate || ''}
                onChange={(event) => {
                  if (!store?.id) return;
                  void setPurchaseOrderDueDate(row.order.id, store.id, event.target.value).then(load);
                }}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white/70 p-3 space-y-2">
        <p className="text-sm font-semibold">Record a payment</p>
        <select aria-label="Supplier to pay" value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setOrderId(''); }} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="">Choose supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select aria-label="Purchase order" value={orderId} onChange={(event) => setOrderId(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <option value="">Apply to supplier account</option>
          {payables.filter((row) => row.order.supplier_id === supplierId).map((row) => (
            <option key={row.order.id} value={row.order.id}>{row.order.order_number} · balance {money(row.balance)}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="Payment amount" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <select aria-label="Payment method" value={method} onChange={(event) => setMethod(event.target.value as SupplierPayMethod)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
            <option value="bank">Bank</option>
          </select>
        </div>
        <input aria-label="Payment note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        {error && <p className="text-xs text-red-700">{error}</p>}
        <button type="button" onClick={() => void pay()} disabled={!supplierId} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Save payment
        </button>
      </div>

      {statementPayments.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">Statement</p>
          <ul className="space-y-1">
            {statementPayments.slice(0, 12).map((payment) => (
              <li key={payment.id} className="flex justify-between text-xs text-gray-700">
                <span>{new Date(payment.paid_at).toLocaleDateString('en-GH')} · {payment.method} · {payment.created_by_name}</span>
                <span>{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

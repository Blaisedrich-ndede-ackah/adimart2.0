import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Pencil, Plus, Users, X } from 'lucide-react';
import {
  createCustomer,
  db,
  getCurrentStoreCustomers,
  getCustomerOpeningPayments,
  getCurrentStoreTransactions,
  LocalCustomer,
  LocalCustomerOpeningPayment,
  LocalCreditPayment,
  LocalTransaction,
  getCreditPaymentsForTransaction,
  recordCustomerOpeningPayment,
  recordCreditPayment,
  setCustomerActive,
  updateCustomer,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { triggerPushSync } from '@/lib/sync';

export default function CustomersPage() {
  const { currentUser } = useAuthStore();
  const money = useFormatMoney();
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [paymentsByCustomer, setPaymentsByCustomer] = useState<
    Record<string, LocalCustomerOpeningPayment[]>
  >({});
  const [creditPaymentsByTransaction, setCreditPaymentsByTransaction] = useState<
    Record<string, LocalCreditPayment[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocalCustomer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allCustomers, allTransactions] = await Promise.all([
        getCurrentStoreCustomers(),
        getCurrentStoreTransactions(),
      ]);
      const activeAndArchived = allCustomers.sort((a, b) =>
        Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)
      );
      setCustomers(activeAndArchived);
      const creditTransactions = allTransactions.filter((transaction) =>
        transaction.payment_method === 'credit' && Boolean(transaction.customer_id)
      );
      setTransactions(creditTransactions);
      const paymentEntries = await Promise.all(
        allCustomers.map(async (customer) => [
          customer.id,
          await getCustomerOpeningPayments(customer.id),
        ] as const)
      );
      setPaymentsByCustomer(Object.fromEntries(paymentEntries));
      const creditPaymentEntries = await Promise.all(
        creditTransactions.map(async (transaction) => [
          transaction.id,
          await getCreditPaymentsForTransaction(transaction.id),
        ] as const)
      );
      setCreditPaymentsByTransaction(Object.fromEntries(creditPaymentEntries));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setName('');
    setPhone('');
    setOpeningBalance('');
    setError('');
  };

  const startEdit = (customer: LocalCustomer) => {
    setIsFormOpen(true);
    setEditing(customer);
    setName(customer.name);
    setPhone(customer.phone);
    setOpeningBalance('');
    setError('');
  };

  const handleSaveCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await updateCustomer(editing.id, name, phone);
      } else {
        const amount = openingBalance.trim() ? Number(openingBalance) : 0;
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error('Enter a valid opening balance.');
        }
        await createCustomer(name, phone, amount);
      }
      resetForm();
      setStatus(editing ? 'Customer details updated.' : 'Customer registered.');
      await load();
      void triggerPushSync('customer-save');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpeningPayment = async (customer: LocalCustomer) => {
    setError('');
    setSaving(true);
    try {
      const amount = Number(paymentAmounts[customer.id]);
      const payment = await recordCustomerOpeningPayment(
        customer.id,
        amount,
        currentUser?.name || ''
      );
      setPaymentAmounts((current) => ({ ...current, [customer.id]: '' }));
      setPaymentsByCustomer((current) => ({
        ...current,
        [customer.id]: [...(current[customer.id] || []), payment],
      }));
      setStatus(`Opening balance payment of ${money(payment.amount)} recorded.`);
      await load();
      void triggerPushSync('customer-opening-payment');
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreditSalePayment = async (transaction: LocalTransaction) => {
    setError('');
    setSaving(true);
    try {
      const amount = Number(paymentAmounts[transaction.id]);
      await recordCreditPayment(transaction.id, amount, currentUser?.name || '');
      setPaymentAmounts((current) => ({ ...current, [transaction.id]: '' }));
      setStatus(`Credit sale payment of ${money(amount)} recorded.`);
      await load();
      void triggerPushSync('customer-credit-payment');
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (customer: LocalCustomer) => {
    setError('');
    try {
      await setCustomerActive(customer.id, customer.is_active !== 1);
      await load();
      setStatus(customer.is_active === 1 ? 'Customer archived.' : 'Customer reactivated.');
      void triggerPushSync('customer-status');
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not update customer.');
    }
  };

  const creditByCustomer = new Map<string, LocalTransaction[]>();
  for (const transaction of transactions) {
    const customerTransactions = creditByCustomer.get(transaction.customer_id!) || [];
    customerTransactions.push(transaction);
    creditByCustomer.set(transaction.customer_id!, customerTransactions);
  }
  const totalReceivable = customers.reduce((total, customer) => {
    const salesBalance = (creditByCustomer.get(customer.id) || []).reduce(
      (balance, transaction) => balance + (Number(transaction.credit_balance) || 0),
      0
    );
    return total + salesBalance + (Number(customer.opening_balance_remaining) || 0);
  }, 0);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-lg">Customers book</h1>
            <p className="text-emerald-200 text-xs">Registered customers, credit sales and account balances</p>
          </div>
          <button
            type="button"
            onClick={() => { resetForm(); setIsFormOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-emerald-800"
          >
            <Plus className="h-4 w-4" /> Add customer
          </button>
        </div>
      </div>

      <div className="page-content space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Registered customers</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {customers.filter((customer) => customer.is_active === 1).length}
            </p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
            <p className="text-xs text-amber-800">Total outstanding</p>
            <p className="mt-1 text-xl font-bold text-amber-900">{money(totalReceivable)}</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {status && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{status}</p>}

        {isFormOpen && (
          <form onSubmit={(event) => void handleSaveCustomer(event)} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editing ? 'Edit customer' : 'Register customer'}</h2>
              <button type="button" onClick={resetForm} aria-label="Close form"><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <label className="block text-sm text-gray-700">
              Customer name *
              <input
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
              />
            </label>
            <label className="block text-sm text-gray-700">
              Phone (optional)
              <input
                type="tel"
                maxLength={30}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
              />
            </label>
            {!editing && (
              <label className="block text-sm text-gray-700">
                Starting account balance (optional)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5"
                />
              </label>
            )}
            {!editing && (
              <p className="text-xs text-gray-500">Enter any credit the customer already owes. It will be added to their account balance.</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Save customer' : 'Register customer'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : customers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <Users className="mx-auto h-9 w-9 text-gray-400" />
            <p className="mt-3 font-semibold text-gray-800">No customers registered yet</p>
            <p className="mt-1 text-sm text-gray-500">Register a customer before recording a credit sale.</p>
            <button type="button" onClick={() => { resetForm(); setIsFormOpen(true); }} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
              Add first customer
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {customers.map((customer) => {
              const customerSales = creditByCustomer.get(customer.id) || [];
              const salesBalance = customerSales.reduce(
                (balance, transaction) => balance + (Number(transaction.credit_balance) || 0),
                0
              );
              const balance = salesBalance + (Number(customer.opening_balance_remaining) || 0);
              const expanded = expandedCustomerId === customer.id;
              return (
                <section key={customer.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedCustomerId(expanded ? null : customer.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-2 font-semibold text-gray-900">
                          <span className="truncate">{customer.name}</span>
                          {customer.is_active !== 1 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">Archived</span>}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">{customer.phone || 'No phone number'}</span>
                      </button>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Account balance</p>
                        <p className={`font-bold ${balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>{money(balance)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(customer)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchive(customer)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700"
                      >
                        {customer.is_active === 1 ? 'Archive' : 'Reactivate'}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="space-y-3 border-t border-gray-100 bg-gray-50 p-4">
                      {customer.opening_balance > 0 && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-amber-900">Starting balance</span>
                            <span className="font-bold text-amber-900">{money(customer.opening_balance_remaining)}</span>
                          </div>
                          <p className="mt-1 text-xs text-amber-800">Originally recorded: {money(customer.opening_balance)}</p>
                          {customer.is_active === 1 && customer.opening_balance_remaining > 0 && (
                            <div className="mt-3 flex gap-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                max={customer.opening_balance_remaining}
                                step="0.01"
                                value={paymentAmounts[customer.id] || ''}
                                onChange={(event) => setPaymentAmounts((current) => ({ ...current, [customer.id]: event.target.value }))}
                                placeholder="Payment amount"
                                aria-label={`Opening balance payment for ${customer.name}`}
                                className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => void handleOpeningPayment(customer)}
                                disabled={saving || !paymentAmounts[customer.id]}
                                className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Record cash payment
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {customerSales.map((transaction) => (
                        <div key={transaction.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
                          <div className="flex justify-between gap-3 text-sm">
                            <div>
                              <p className="font-medium text-gray-800">Credit sale · {transaction.receipt_number}</p>
                              <p className="mt-1 text-xs text-gray-500">{new Date(transaction.created_at).toLocaleDateString()}</p>
                              {(creditPaymentsByTransaction[transaction.id] || []).map((payment) => (
                                <p key={payment.id} className="mt-1 text-[11px] text-gray-500">
                                  Cash payment {money(payment.amount)} · {new Date(payment.created_at).toLocaleDateString()}
                                </p>
                              ))}
                            </div>
                            <span className="font-semibold text-amber-800">{money(transaction.credit_balance || 0)}</span>
                          </div>
                          {customer.is_active === 1 && (transaction.credit_balance || 0) > 0 && (
                            <div className="flex gap-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                max={transaction.credit_balance || 0}
                                step="0.01"
                                value={paymentAmounts[transaction.id] || ''}
                                onChange={(event) => setPaymentAmounts((current) => ({ ...current, [transaction.id]: event.target.value }))}
                                placeholder="Payment amount"
                                aria-label={`Credit sale payment for ${customer.name} receipt ${transaction.receipt_number}`}
                                className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => void handleCreditSalePayment(transaction)}
                                disabled={saving || !paymentAmounts[transaction.id]}
                                className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Record cash payment
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {(paymentsByCustomer[customer.id] || []).map((payment) => (
                        <div key={payment.id} className="flex justify-between gap-3 text-xs text-gray-600">
                          <span>{payment.entry_type === 'opening_balance' ? 'Opening balance added' : 'Opening balance payment'} · {new Date(payment.created_at).toLocaleDateString()}</span>
                          <span>{money(payment.amount)}</span>
                        </div>
                      ))}
                      {customerSales.length === 0 && customer.opening_balance <= 0 && (
                        <p className="text-sm text-gray-500">No credit balance or credit sales recorded.</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

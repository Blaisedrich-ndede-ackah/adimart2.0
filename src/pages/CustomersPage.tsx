import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Pencil, Plus, Send, Users, X } from 'lucide-react';
import {
  createCustomer,
  db,
  LocalCustomerAccountReceipt,
  getCurrentStoreCustomers,
  getCustomerOpeningPayments,
  getCurrentStoreTransactions,
  LocalCustomer,
  LocalCustomerOpeningPayment,
  LocalCustomerWalletTransaction,
  LocalSaleReturn,
  LocalCreditPayment,
  LocalTransaction,
  getCurrentStoreId,
  getCreditPaymentsForTransaction,
  recordCustomerAccountPayment,
  setCustomerActive,
  updateCustomer,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { triggerPushSync } from '@/lib/sync';
import { shareReceipt, downloadReceipt, type PDFReceiptData } from '@/lib/receiptGenerator';
import { printReceipt } from '@/lib/printService';
import {
  countCurrentStoreCustomerRecipients,
  sendBulkSmsToCurrentStoreCustomers,
  getCurrentStoreBulkSmsCampaigns,
  type LocalBulkSmsCampaign,
} from '@/lib/bulkSms';

export default function CustomersPage() {
  const { currentUser, currentStore } = useAuthStore();
  const money = useFormatMoney();
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [paymentsByCustomer, setPaymentsByCustomer] = useState<
    Record<string, LocalCustomerOpeningPayment[]>
  >({});
  const [creditPaymentsByTransaction, setCreditPaymentsByTransaction] = useState<
    Record<string, LocalCreditPayment[]>
  >({});
  const [accountReceiptsByCustomer, setAccountReceiptsByCustomer] = useState<
    Record<string, LocalCustomerAccountReceipt[]>
  >({});
  const [walletTransactionsByCustomer, setWalletTransactionsByCustomer] = useState<
    Record<string, LocalCustomerWalletTransaction[]>
  >({});
  const [returnsByCustomer, setReturnsByCustomer] = useState<Record<string, LocalSaleReturn[]>>({});
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
  const [repaymentMethods, setRepaymentMethods] = useState<Record<string, 'cash' | 'momo' | 'cheque' | 'split'>>({});
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState('');
  const [smsNotice, setSmsNotice] = useState('');
  const [smsCampaigns, setSmsCampaigns] = useState<LocalBulkSmsCampaign[]>([]);
  const [recipientCount, setRecipientCount] = useState(0);

  const t = useT();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allCustomers, allTransactions, campaigns, recipients] = await Promise.all([
        getCurrentStoreCustomers(),
        getCurrentStoreTransactions(),
        getCurrentStoreBulkSmsCampaigns(),
        countCurrentStoreCustomerRecipients(),
      ]);
      const activeAndArchived = allCustomers.sort((a, b) =>
        Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)
      );
      setCustomers(activeAndArchived);
      setSmsCampaigns(campaigns);
      setRecipientCount(recipients);
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
      const accountReceiptEntries = await Promise.all(
        allCustomers.map(async (customer) => [
          customer.id,
          await db.customer_account_receipts.where('customer_id').equals(customer.id).sortBy('created_at'),
        ] as const)
      );
      setAccountReceiptsByCustomer(Object.fromEntries(accountReceiptEntries));
      const walletEntries = await Promise.all(
        allCustomers.map(async (customer) => [
          customer.id,
          await db.customer_wallet_transactions.where('customer_id').equals(customer.id).sortBy('created_at'),
        ] as const)
      );
      setWalletTransactionsByCustomer(Object.fromEntries(walletEntries));
      const storeId = await getCurrentStoreId();
      const allReturns = storeId
        ? await db.sales_returns.where('store_id').equals(storeId).toArray()
        : [];
      setReturnsByCustomer(Object.fromEntries(allCustomers.map((customer) => [
        customer.id,
        allReturns.filter((saleReturn) => saleReturn.customer_id === customer.id).sort(
          (a, b) => a.created_at.localeCompare(b.created_at)
        ),
      ])));
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

  const handleAccountPayment = async (customer: LocalCustomer) => {
    setError('');
    setSaving(true);
    try {
      const method = repaymentMethods[customer.id] || 'cash';
      const amounts = method === 'split'
        ? {
            cash: Number(paymentAmounts[`${customer.id}:cash`] || 0),
            momo: Number(paymentAmounts[`${customer.id}:momo`] || 0),
            cheque: Number(paymentAmounts[`${customer.id}:cheque`] || 0),
          }
        : {
            cash: method === 'cash' ? Number(paymentAmounts[customer.id]) : 0,
            momo: method === 'momo' ? Number(paymentAmounts[customer.id]) : 0,
            cheque: method === 'cheque' ? Number(paymentAmounts[customer.id]) : 0,
          };
      const receipt = await recordCustomerAccountPayment(
        customer.id,
        { method, ...amounts },
        currentUser?.name || ''
      );
      setPaymentAmounts((current) => ({
        ...current,
        [customer.id]: '',
        [`${customer.id}:cash`]: '',
        [`${customer.id}:momo`]: '',
        [`${customer.id}:cheque`]: '',
      }));
      setStatus(`Payment of ${money(receipt.amount)} recorded. Balance remaining: ${money(receipt.balance_after)}.`);
      await load();
      void triggerPushSync('customer-account-payment');
    } catch (paymentError: unknown) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  const buildAccountReceiptData = (
    receipt: LocalCustomerAccountReceipt,
    customerName: string
  ): PDFReceiptData => ({
    storeName: currentStore?.name || 'Store',
    storeAddress: currentStore?.address || '',
    supportNumber: currentStore?.support_number || '',
    storeLogoUrl: currentStore?.logo_url || '',
    currencyCode: currentStore?.currency_code || 'GHS',
    receiptNumber: receipt.receipt_number,
    cashierName: receipt.created_by,
    dateTime: new Date(receipt.created_at).toLocaleString('en-GH'),
    items: [],
    subtotal: 0,
    discount: 0,
    total: receipt.amount,
    paymentMethod: Number(receipt.cash_amount > 0) +
      Number(receipt.momo_amount > 0) +
      Number(receipt.cheque_amount > 0) > 1
      ? 'split'
      : receipt.cash_amount > 0
        ? 'cash'
        : receipt.momo_amount > 0
          ? 'Mobile Money (MoMo)'
          : 'Cheque',
    cashAmount: receipt.cash_amount,
    momoAmount: receipt.momo_amount,
    chequeAmount: receipt.cheque_amount,
    customerName,
    amountPaid: receipt.amount,
    balanceAfterPayment: receipt.balance_after,
    receiptPurpose: 'credit-payment',
  });

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

  const handleSendBulkSms = async () => {
    if (smsMessage.trim().length === 0) {
      setSmsError(t('bulkSms.message'));
      return;
    }
    setSmsSending(true);
    setSmsError('');
    setSmsNotice('');
    try {
      const result = await sendBulkSmsToCurrentStoreCustomers({ message: smsMessage });
      if (!result.success) {
        setSmsError(result.error || t('bulkSms.failed', { error: 'Unknown error' }));
        return;
      }
      const count = result.sentCount;
      setSmsNotice(
        count === result.recipientCount
          ? t('bulkSms.sent', { count })
          : t('bulkSms.partial', { sent: result.sentCount, total: result.recipientCount, failed: result.failedCount })
      );
      setSmsMessage('');
      await load();
      void triggerPushSync('bulk-sms');
    } catch (sendError) {
      setSmsError(sendError instanceof Error ? sendError.message : t('bulkSms.failed', { error: 'Unknown error' }));
    } finally {
      setSmsSending(false);
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
  const totalWalletCredit = customers.reduce((total, customer) => total + (Number(customer.wallet_balance) || 0), 0);

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

      <div className="page-body space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
          <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 shadow-sm">
            <p className="text-xs text-teal-800">Customer store credit</p>
            <p className="mt-1 text-xl font-bold text-teal-900">{money(totalWalletCredit)}</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {status && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{status}</p>}

        {/* Bulk SMS composer — owner-only promotional broadcast */}
        <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <Send className="h-4 w-4 text-emerald-700" />
            <h2 className="font-semibold text-gray-900">{t('bulkSms.title')}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">{t('bulkSms.subtitle')}</p>

          <label className="block text-sm text-gray-700">
            {t('bulkSms.message')}
            <textarea
              rows={3}
              maxLength={460}
              value={smsMessage}
              onChange={(event) => setSmsMessage(event.target.value)}
              placeholder="e.g. New stock arrived — visit us this weekend for fresh items!"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 resize-y"
            />
            <span className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
              <span>{t('bulkSms.messageHint')}</span>
              <span className={smsMessage.length > 460 ? 'text-red-500 font-medium' : ''}>{smsMessage.length}/460</span>
            </span>
          </label>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white border border-gray-200 px-3 py-2">
            <div>
              <p className="text-xs text-gray-500">{t('bulkSms.recipients')}</p>
              <p className="text-sm font-semibold text-gray-900">
                {recipientCount === 0 ? t('bulkSms.recipientsEmpty') : t('bulkSms.recipientsCount', { count: recipientCount })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSendBulkSms()}
              disabled={smsSending || recipientCount === 0 || smsMessage.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {smsSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {smsSending ? t('bulkSms.sending') : t('bulkSms.send')}
            </button>
          </div>

          {smsError && (
            <p role="alert" className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {smsError}
            </p>
          )}
          {smsNotice && (
            <p role="status" className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {smsNotice}
            </p>
          )}

          {smsCampaigns.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('bulkSms.history')}</p>
              <div className="space-y-2">
                {smsCampaigns.slice(0, 5).map((campaign) => (
                  <div key={campaign.id} className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-700 line-clamp-1">{campaign.message}</p>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        campaign.status === 'sent' ? 'bg-emerald-100 text-emerald-800' :
                        campaign.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {campaign.sent_count}/{campaign.recipient_count} sent · {new Date(campaign.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

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
              <p className="text-xs text-gray-500">Enter credit not already recorded as a credit sale. It will be added to their account balance.</p>
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
                        <span className="mt-1 block text-xs text-teal-800">
                          Wallet credit: {money(customer.wallet_balance || 0)}
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
                      {customer.is_active === 1 && balance > 0 && (
                        <div className="space-y-3 rounded-xl border border-amber-200 bg-white p-3">
                          <p className="text-sm font-semibold text-gray-900">Record account payment</p>
                          <label className="block text-xs font-medium text-gray-600">
                            Payment method
                            <select
                              value={repaymentMethods[customer.id] || 'cash'}
                              onChange={(event) => setRepaymentMethods((current) => ({
                                ...current,
                                [customer.id]: event.target.value as 'cash' | 'momo' | 'cheque' | 'split',
                              }))}
                              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                            >
                              <option value="cash">Cash</option>
                              <option value="momo">Mobile Money (MoMo)</option>
                              <option value="cheque">Cheque</option>
                              <option value="split">Split payment</option>
                            </select>
                          </label>
                          {(repaymentMethods[customer.id] || 'cash') === 'split' ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              {(['cash', 'momo', 'cheque'] as const).map((kind) => (
                                <label key={kind} className="text-xs font-medium capitalize text-gray-600">
                                  {kind === 'momo' ? 'MoMo' : kind}
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max={balance}
                                    step="0.01"
                                    value={paymentAmounts[`${customer.id}:${kind}`] || ''}
                                    onChange={(event) => setPaymentAmounts((current) => ({
                                      ...current,
                                      [`${customer.id}:${kind}`]: event.target.value,
                                    }))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                                  />
                                </label>
                              ))}
                            </div>
                          ) : (
                            <label className="block text-xs font-medium text-gray-600">
                              Amount
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                max={balance}
                                step="0.01"
                                value={paymentAmounts[customer.id] || ''}
                                onChange={(event) => setPaymentAmounts((current) => ({
                                  ...current,
                                  [customer.id]: event.target.value,
                                }))}
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                              />
                            </label>
                          )}
                          <p className="text-xs text-gray-500">Payment is automatically applied to the oldest outstanding balance first.</p>
                          <button
                            type="button"
                            onClick={() => void handleAccountPayment(customer)}
                            disabled={saving || !(
                              (repaymentMethods[customer.id] || 'cash') === 'split'
                                ? paymentAmounts[`${customer.id}:cash`] || paymentAmounts[`${customer.id}:momo`] || paymentAmounts[`${customer.id}:cheque`]
                                : paymentAmounts[customer.id]
                            )}
                            className="w-full rounded-lg bg-amber-700 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {saving ? 'Saving payment…' : `Record payment · balance ${money(balance)}`}
                          </button>
                        </div>
                      )}
                      {customer.opening_balance > 0 && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-amber-900">Starting balance</span>
                            <span className="font-bold text-amber-900">{money(customer.opening_balance_remaining)}</span>
                          </div>
                          <p className="mt-1 text-xs text-amber-800">Originally recorded: {money(customer.opening_balance)}</p>
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
                                      Payment {money(payment.amount)} ({payment.payment_method || 'cash'}) · {new Date(payment.created_at).toLocaleDateString()}
                                </p>
                              ))}
                            </div>
                            <span className="font-semibold text-amber-800">{money(transaction.credit_balance || 0)}</span>
                          </div>
                        </div>
                      ))}
                      {(paymentsByCustomer[customer.id] || []).map((payment) => (
                        <div key={payment.id} className="flex justify-between gap-3 text-xs text-gray-600">
                          <span>{payment.entry_type === 'opening_balance' ? 'Opening balance added' : `Account payment (${payment.payment_method || 'cash'})`} · {new Date(payment.created_at).toLocaleDateString()}</span>
                          <span>{money(payment.amount)}</span>
                        </div>
                      ))}
                      {(accountReceiptsByCustomer[customer.id] || []).map((receipt) => (
                        <div key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-white p-3">
                          <div className="text-xs">
                            <p className="font-semibold text-gray-800">Receipt {receipt.receipt_number}</p>
                            <p className="mt-1 text-gray-500">
                              Paid {money(receipt.amount)} · Balance {money(receipt.balance_after)}
                              {receipt.cash_amount ? ` · Cash ${money(receipt.cash_amount)}` : ''}
                              {receipt.momo_amount ? ` · MoMo ${money(receipt.momo_amount)}` : ''}
                              {receipt.cheque_amount ? ` · Cheque ${money(receipt.cheque_amount)}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => { void printReceipt(buildAccountReceiptData(receipt, customer.name)); }}
                              className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold text-gray-700"
                            >
                              Print
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadReceipt(buildAccountReceiptData(receipt, customer.name))}
                              className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold text-gray-700"
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => { void shareReceipt(buildAccountReceiptData(receipt, customer.name)); }}
                              className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold text-gray-700"
                            >
                              Share
                            </button>
                          </div>
                        </div>
                      ))}
                      {(walletTransactionsByCustomer[customer.id] || []).map((entry) => (
                        <div key={entry.id} className="flex justify-between gap-3 text-xs text-teal-800">
                          <span>{entry.description} · {new Date(entry.created_at).toLocaleDateString()}</span>
                          <span>{entry.type === 'return_credit' ? '+' : '−'}{money(entry.amount)} · wallet {money(entry.balance_after)}</span>
                        </div>
                      ))}
                      {(returnsByCustomer[customer.id] || [])
                        .filter((saleReturn) => saleReturn.refund_method === 'account')
                        .map((saleReturn) => (
                          <div key={saleReturn.id} className="flex justify-between gap-3 text-xs text-amber-800">
                            <span>Return adjustment · {saleReturn.receipt_number} · {new Date(saleReturn.created_at).toLocaleDateString()}</span>
                            <span>Debt −{money(saleReturn.debt_applied)}{saleReturn.wallet_credit > 0 ? ` · wallet +${money(saleReturn.wallet_credit)}` : ''}</span>
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

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  Users,
  X,
  Phone,
  CreditCard,
  Wallet,
  History,
  Clock,
  BellRing,
} from 'lucide-react';
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
  type LocalLocation,
  LocalSaleReturn,
  LocalCreditPayment,
  LocalTransaction,
  getCurrentStoreId,
  getCreditPaymentsForTransaction,
  recordCustomerAccountPayment,
  setCustomerActive,
  updateCustomer,
} from '@/lib/dexie';
import { listLocations } from '@/lib/warehouse';
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
import DebtRemindersPanel from '@/components/DebtRemindersPanel';
import { setCustomerDebtReminderOptOut } from '@/lib/debtReminders';
import { shopOwnerLedger, type ShopTransaction } from '@/lib/shopClient';
import {
  formatCustomerAddress,
  joinCustomerAddress,
  splitCustomerAddress,
} from '@/lib/customerAddress';
import { canRecordCustomerPayments } from '@/lib/staffAccess';
import { sendReceiptSmsIfCustomerOnFile } from '@/lib/smsWallet';

interface CustomersPageProps {
  onNavigate?: (page: string) => void;
}

function CustomersPageView({ onNavigate }: CustomersPageProps = {}) {
  const { currentUser, currentStore } = useAuthStore();
  const money = useFormatMoney();
  const isOwner = currentUser?.role === 'owner';
  const canTakePayments = canRecordCustomerPayments(currentUser, currentStore);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});

  const locationNameById = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name] as const)),
    [locations]
  );
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const preferredLocation = customer.location_id
        ? locationNameById.get(customer.location_id) || ''
        : '';
      const searchableText = [
        customer.name,
        customer.phone,
        formatCustomerAddress(customer.address),
        customer.address || '',
        preferredLocation,
      ]
        .join(' ')
        .toLocaleLowerCase();
      return searchableText.includes(query);
    });
  }, [customers, searchQuery, locationNameById]);
  const [repaymentMethods, setRepaymentMethods] = useState<Record<string, 'cash' | 'momo' | 'cheque' | 'split'>>({});
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState('');
  const [smsNotice, setSmsNotice] = useState('');
  const [smsCampaigns, setSmsCampaigns] = useState<LocalBulkSmsCampaign[]>([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [onlineByCustomer, setOnlineByCustomer] = useState<Record<string, ShopTransaction[]>>({});
  const [onlineBalance, setOnlineBalance] = useState<Record<string, number>>({});
  const [onlineError, setOnlineError] = useState('');

  const t = useT();

  useEffect(() => {
    if (!expandedCustomerId || currentUser?.role !== 'owner' || !currentStore?.id) return;
    const customerId = expandedCustomerId;
    void shopOwnerLedger(currentStore.id, currentUser.id, customerId)
      .then((result) => {
        setOnlineByCustomer((prev) => ({ ...prev, [customerId]: result.transactions }));
        const account = result.accounts[0];
        if (account) setOnlineBalance((prev) => ({ ...prev, [customerId]: account.balance }));
        setOnlineError('');
      })
      .catch((err: unknown) => {
        setOnlineError(err instanceof Error ? err.message : 'Online wallet unavailable');
      });
  }, [expandedCustomerId, currentUser?.id, currentUser?.role, currentStore?.id]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [allCustomers, allTransactions, campaigns, recipients] = await Promise.all([
        getCurrentStoreCustomers(),
        getCurrentStoreTransactions(),
        getCurrentStoreBulkSmsCampaigns(),
        countCurrentStoreCustomerRecipients(),
      ]);
      const storeId = await getCurrentStoreId();
      if (storeId) {
        const locs = await listLocations(storeId);
        setLocations(locs.filter((l) => l.is_active === 1));
      }
      const activeAndArchived = allCustomers.sort((a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        String(a.name || '').localeCompare(String(b.name || ''))
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
      const allReturns = storeId
        ? await db.sales_returns.where('store_id').equals(storeId).toArray()
        : [];
      setReturnsByCustomer(Object.fromEntries(allCustomers.map((customer) => [
        customer.id,
        allReturns.filter((saleReturn) => saleReturn.customer_id === customer.id).sort(
          (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
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
    setStreet('');
    setCity('');
    setRegion('');
    setOpeningBalance('');
    setLocationId(null);
    setError('');
  };

  const openCreateForm = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setStreet('');
    setCity('');
    setRegion('');
    setOpeningBalance('');
    setLocationId(null);
    setError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    resetForm();
  };

  useEffect(() => {
    if (!isFormOpen) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      addButtonRef.current?.focus();
    };
  }, [isFormOpen]);

  useEffect(() => {
    if (!isFormOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      resetForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFormOpen, saving]);

  const startEdit = (customer: LocalCustomer) => {
    setIsFormOpen(true);
    setEditing(customer);
    const parts = splitCustomerAddress(customer.address);
    setName(String(customer.name || ''));
    setPhone(String(customer.phone || ''));
    setStreet(parts.street);
    setCity(parts.city);
    setRegion(parts.region);
    setOpeningBalance('');
    setLocationId(customer.location_id ?? null);
    setError('');
  };

  const handleSaveCustomer = async () => {
    setError('');
    setSaving(true);
    try {
      const address = joinCustomerAddress({ street, city, region });
      const wasEditing = Boolean(editing);
      if (editing) {
        await updateCustomer(editing.id, name, phone, locationId, address);
      } else {
        const amount = openingBalance.trim() ? Number(openingBalance) : 0;
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error('Enter a valid opening balance.');
        }
        const created = await createCustomer(name, phone, amount, locationId, address);
        setCustomers((current) => {
          const next = [created, ...current.filter((row) => row.id !== created.id)];
          return next.sort((a, b) =>
            Number(b.is_active) - Number(a.is_active) ||
            String(a.name || '').localeCompare(String(b.name || ''))
          );
        });
      }
      resetForm();
      setStatus(wasEditing ? 'Customer details updated.' : 'Customer registered.');
      await load({ silent: true });
      void triggerPushSync('customer-save');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleAccountPayment = async (customer: LocalCustomer) => {
    if (!canRecordCustomerPayments(currentUser, currentStore)) {
      setError('The owner has not allowed cashiers to record customer payments.');
      return;
    }
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
      let smsNote = '';
      if (currentStore?.id && currentUser?.id) {
        smsNote = await sendReceiptSmsIfCustomerOnFile({
          storeId: currentStore.id,
          userId: currentUser.id,
          customerId: customer.id,
          storeName: currentStore.name,
          receiptNumber: receipt.receipt_number,
          totalLabel: money(receipt.amount),
          balanceLabel: money(receipt.balance_after),
        });
      }
      setStatus(`Payment of ${money(receipt.amount)} recorded. Balance remaining: ${money(receipt.balance_after)}.${smsNote ? ` ${smsNote}` : ''}`);
      await load({ silent: true });
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
      await load({ silent: true });
      setStatus(customer.is_active === 1 ? 'Customer archived.' : 'Customer reactivated.');
      void triggerPushSync('customer-status');
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not update customer.');
    }
  };

  const handleToggleReminderOptOut = async (customer: LocalCustomer) => {
    setError('');
    const optedOut = (customer.debt_reminder_opt_out ?? 0) === 1;
    try {
      await setCustomerDebtReminderOptOut(customer.id, !optedOut);
      await load({ silent: true });
      setStatus(
        optedOut
          ? `${customer.name} will receive debt reminders again.`
          : `${customer.name} will no longer receive automated debt reminders.`
      );
      void triggerPushSync('customer-reminder-optout');
    } catch (optOutError) {
      setError(optOutError instanceof Error ? optOutError.message : 'Could not update reminder preference.');
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
      await load({ silent: true });
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
  const formDirty = Boolean(
    editing || name.trim() || phone.trim() || street.trim() || city.trim() || region.trim() || openingBalance.trim()
  );
  const fieldClass = 'mt-1.5 w-full min-h-11 rounded-xl border border-gray-200 px-3.5 py-3 text-base focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:ring-offset-1 transition-all';

  return (
    <>
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 mb-2">
              <Users className="h-3.5 w-3.5" />
              <span>Customers book</span>
            </div>
            <h1 className="truncate text-white font-bold text-lg tracking-tight">
              {isOwner ? 'Customer management' : 'Customer payments'}
            </h1>
            <p className="text-emerald-200 text-xs mt-0.5">
              {isOwner
                ? 'Registered customers, credit sales, and account balances'
                : 'Record a payment and print the receipt'}
            </p>
          </div>
          {isOwner && (
            <button
              ref={addButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isFormOpen}
              onClick={openCreateForm}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 transition-all touch-target"
            >
              <Plus className="h-4 w-4" /> Add customer
            </button>
          )}
        </div>
      </div>

      <div className="page-body space-y-5">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Active customers</p>
                <p className="mt-1.5 text-2xl font-bold text-gray-900">
                  {customers.filter((customer) => customer.is_active === 1).length}
                </p>
              </div>
              <div className="rounded-lg bg-white/60 p-2">
                <Users className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-amber-100/50 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Total outstanding</p>
                <p className="mt-1.5 text-2xl font-bold text-amber-900">{money(totalReceivable)}</p>
              </div>
              <div className="rounded-lg bg-white/60 p-2">
                <CreditCard className="h-5 w-5 text-amber-500" />
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-teal-100/50 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-teal-600 uppercase tracking-wider">Store credit (wallet)</p>
                <p className="mt-1.5 text-2xl font-bold text-teal-900">{money(totalWalletCredit)}</p>
              </div>
              <div className="rounded-lg bg-white/60 p-2">
                <Wallet className="h-5 w-5 text-teal-500" />
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total customers</p>
                <p className="mt-1.5 text-2xl font-bold text-gray-900">{customers.length}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <History className="h-5 w-5 text-gray-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Alert / status toast */}
        {error && !isFormOpen && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700 shadow-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {status && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800 shadow-sm">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{status}</span>
          </div>
        )}

        {/* Bulk SMS composer — owner-only promotional broadcast */}
        {isOwner && <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="rounded-lg bg-emerald-100 p-1.5">
              <Send className="h-4 w-4 text-emerald-600" />
            </div>
            <h2 className="font-semibold text-gray-900">{t('bulkSms.title')}</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">{t('bulkSms.subtitle')}</p>

          <label className="block text-sm font-medium text-gray-700">
            {t('bulkSms.message')}
            <textarea
              rows={3}
              maxLength={460}
              value={smsMessage}
              onChange={(event) => setSmsMessage(event.target.value)}
              placeholder="e.g. New stock arrived — visit us this weekend for fresh items!"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 resize-y focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:ring-offset-1 transition-all"
            />
            <span className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
              <span>{t('bulkSms.messageHint')}</span>
              <span className={smsMessage.length > 460 ? 'text-red-500 font-medium' : ''}>{smsMessage.length}/460</span>
            </span>
          </label>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white border border-gray-200 px-3.5 py-2.5 shadow-sm">
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
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-all"
            >
              {smsSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {smsSending ? t('bulkSms.sending') : t('bulkSms.send')}
            </button>
          </div>

          {smsError && (
            <p role="alert" className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {smsError}
            </p>
          )}
          {smsNotice && (
            <p role="status" className="mt-3 text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              {smsNotice}
            </p>
          )}

          {smsCampaigns.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('bulkSms.history')}</p>
              <div className="space-y-2">
                {smsCampaigns.slice(0, 5).map((campaign) => (
                  <div key={campaign.id} className="rounded-xl bg-white border border-gray-100 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-gray-700 line-clamp-1">{campaign.message}</p>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        campaign.status === 'sent' ? 'bg-emerald-100 text-emerald-700' :
                        campaign.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-gray-400">
                      {campaign.sent_count}/{campaign.recipient_count} sent · {new Date(campaign.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>}

        {isOwner && (
          <DebtRemindersPanel onOpenSettings={onNavigate ? () => onNavigate('settings') : undefined} />
        )}


        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm text-gray-500">Loading customers…</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 mb-4">
              <Users className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="font-semibold text-gray-900">No customers registered yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              {isOwner
                ? 'Register a customer before recording a credit sale.'
                : 'Payments show up here after the owner registers a customer.'}
            </p>
            {isOwner && (
              <button
                type="button"
                onClick={openCreateForm}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-all touch-target"
              >
                <Plus className="h-4 w-4" /> Add first customer
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <label className="sr-only" htmlFor="customer-search">
                Search customers by name, phone, address, or preferred location
              </label>
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id="customer-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, phone, address, or location…"
                className="w-full pl-9 pr-10 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear customer search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {filteredCustomers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center shadow-sm" aria-live="polite">
                <h3 className="font-semibold text-gray-900">No matching customers</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Try another name, phone number, address, or preferred location.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Clear search
                </button>
              </div>
            ) : filteredCustomers.map((customer) => {
              const customerSales = creditByCustomer.get(customer.id) || [];
              const salesBalance = customerSales.reduce(
                (balance, transaction) => balance + (Number(transaction.credit_balance) || 0),
                0
              );
              const balance = salesBalance + (Number(customer.opening_balance_remaining) || 0);
              const expanded = expandedCustomerId === customer.id;
              const displayName = String(customer.name || 'Customer');
              const initials = displayName
                .split(/\s+/)
                .map((part) => part[0] || '')
                .join('')
                .toUpperCase()
                .slice(0, 2) || '?';
              const preferredLocationName = customer.location_id
                ? locationNameById.get(customer.location_id) || ''
                : '';
              return (
                <section key={customer.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:shadow-md">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedCustomerId(expanded ? null : customer.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                            <span className="text-emerald-700 font-semibold text-sm">{initials}</span>
                          </div>
                          <div className="min-w-0">
                            <span className="flex items-center gap-2 font-semibold text-gray-900">
                              <span className="truncate block">{displayName}</span>
                              {customer.is_active !== 1 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                  Archived
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-xs text-teal-700 font-medium">
                              <Wallet className="h-3 w-3 mr-1" /> Wallet {money(customer.wallet_balance || 0)}
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-500">
                              <Phone className="h-3 w-3 mr-1" /> {customer.phone || 'No phone number'}
                            </span>
                            {(customer.address || preferredLocationName) && (
                              <span className="mt-0.5 flex items-start gap-1 text-xs text-gray-500">
                                <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                                <span className="min-w-0 break-words">
                                  {[formatCustomerAddress(customer.address), preferredLocationName].filter(Boolean).join(' · ')}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="text-right flex flex-col">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Account balance</p>
                        <p className={`font-bold ${balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {money(balance)}
                        </p>
                      </div>
                    </div>
                    {isOwner && <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(customer)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchive(customer)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        {customer.is_active === 1 ? 'Archive' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleReminderOptOut(customer)}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                          (customer.debt_reminder_opt_out ?? 0) === 1
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <BellRing className="h-3 w-3" />
                        {(customer.debt_reminder_opt_out ?? 0) === 1
                          ? 'Reminders off'
                          : 'Reminders on'}
                      </button>
                    </div>}
                  </div>

                  {expanded && (
                    <div className="space-y-3 border-t border-gray-100 bg-gray-50/50 p-4 backdrop-blur-sm">
                      {canTakePayments && customer.is_active === 1 && balance > 0 && (
                        <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
                          <div className="flex items-center gap-2">
                            <div className="rounded-lg bg-amber-100 p-1.5">
                              <CreditCard className="h-4 w-4 text-amber-600" />
                            </div>
                            <p className="text-sm font-semibold text-gray-900">Record account payment</p>
                          </div>
                          <label className="block text-xs font-medium text-gray-600">
                            Payment method
                            <select
                              value={repaymentMethods[customer.id] || 'cash'}
                              onChange={(event) => setRepaymentMethods((current) => ({
                                ...current,
                                [customer.id]: event.target.value as 'cash' | 'momo' | 'cheque' | 'split',
                              }))}
                              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
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
                                <label key={kind} className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-gray-600 capitalize">
                                    {kind === 'momo' ? 'MoMo' : kind}
                                  </span>
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
                                    className="min-h-11 rounded-xl border border-gray-200 px-3 py-2.5 text-base focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
                                  />
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`payment-amount-${customer.id}`} className="block text-xs font-medium text-gray-600">Amount</label>
                              <input
                                id={`payment-amount-${customer.id}`}
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
                                className="min-h-11 rounded-xl border border-gray-200 px-3 py-2.5 text-base focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
                              />
                            </div>
                          )}
                          <p className="text-xs text-gray-400">Payment is automatically applied to the oldest outstanding balance first.</p>
                          <button
                            type="button"
                            onClick={() => void handleAccountPayment(customer)}
                            disabled={saving || !(
                              (repaymentMethods[customer.id] || 'cash') === 'split'
                                ? paymentAmounts[`${customer.id}:cash`] || paymentAmounts[`${customer.id}:momo`] || paymentAmounts[`${customer.id}:cheque`]
                                : paymentAmounts[customer.id]
                            )}
                            className="w-full min-h-11 rounded-xl bg-amber-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 disabled:hover:bg-amber-700 transition-all touch-target"
                          >
                            {saving ? 'Saving payment…' : `Record payment · balance ${money(balance)}`}
                          </button>
                        </div>
                      )}
                      {customer.opening_balance > 0 && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 shadow-sm">
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-xs font-medium text-amber-900 uppercase tracking-wider">Starting balance</p>
                              <p className="text-sm font-bold text-amber-900">{money(customer.opening_balance_remaining)}</p>
                            </div>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              Originally recorded
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-amber-800">
                            Originally recorded: {money(customer.opening_balance)}
                          </p>
                        </div>
                      )}
                      {customerSales.map((transaction) => (
                        <div key={transaction.id} className="rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm">
                          <div className="flex justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                Credit sale · <span className="text-gray-400 text-xs">{transaction.receipt_number}</span>
                              </p>
                              <p className="mt-1 text-xs text-gray-500">{new Date(transaction.created_at).toLocaleDateString()}</p>
                              {(creditPaymentsByTransaction[transaction.id] || []).map((payment) => (
                                <p key={payment.id} className="mt-1 text-[11px] text-gray-500">
                                  Payment {money(payment.amount)} ({payment.payment_method || 'cash'}) · {new Date(payment.created_at).toLocaleDateString()}
                                </p>
                              ))}
                            </div>
                            <span className="font-semibold text-amber-700">{money(transaction.credit_balance || 0)}</span>
                          </div>
                        </div>
                      ))}
                      {(paymentsByCustomer[customer.id] || []).map((payment) => (
                        <div key={payment.id} className="flex items-center justify-between gap-3 text-sm text-gray-600">
                          <span className="text-gray-700">
                            {payment.entry_type === 'opening_balance' ? 'Opening balance added' : `Account payment (${payment.payment_method || 'cash'})`} ·
                            {new Date(payment.created_at).toLocaleDateString()}
                          </span>
                          <span className="font-semibold text-gray-900">{money(payment.amount)}</span>
                        </div>
                      ))}
                      {(accountReceiptsByCustomer[customer.id] || []).map((receipt) => (
                        <div key={receipt.id} className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-white p-3 shadow-sm">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="rounded-lg bg-emerald-50 p-1.5">
                                <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
                              </div>
                              <p className="font-medium text-gray-900 text-sm">
                                Receipt {receipt.receipt_number}
                              </p>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Paid {money(receipt.amount)} · Balance {money(receipt.balance_after)}
                              {receipt.cash_amount ? ` · Cash ${money(receipt.cash_amount)}` : ''}
                              {receipt.momo_amount ? ` · MoMo ${money(receipt.momo_amount)}` : ''}
                              {receipt.cheque_amount ? ` · Cheque ${money(receipt.cheque_amount)}` : ''}
                            </p>
                          </div>
                          {canTakePayments && (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => { void printReceipt(buildAccountReceiptData(receipt, displayName)); }}
                              className="min-h-11 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors touch-target"
                            >
                              Print
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadReceipt(buildAccountReceiptData(receipt, displayName))}
                              className="min-h-11 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors touch-target"
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => { void shareReceipt(buildAccountReceiptData(receipt, displayName)); }}
                              className="min-h-11 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors touch-target"
                            >
                              Share
                            </button>
                          </div>
                          )}
                        </div>
                      ))}
                      {onlineBalance[customer.id] !== undefined ? (
                        <p className="text-sm font-semibold text-teal-800">Online shop wallet {money(onlineBalance[customer.id] || 0)}</p>
                      ) : null}
                      {onlineError && expanded ? <p className="text-xs text-amber-700">{onlineError}</p> : null}
                      {(onlineByCustomer[customer.id] || []).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-gray-700">{entry.description || entry.entry_type}</span>
                          <span className="text-xs text-gray-400">{new Date(entry.created_at).toLocaleDateString()}</span>
                          <span className={`font-semibold ${entry.direction === 'debit' ? 'text-teal-700' : 'text-emerald-700'}`}>
                            {entry.direction === 'debit' ? '−' : '+'}{money(Number(entry.amount) || 0)}
                          </span>
                        </div>
                      ))}
                      {(walletTransactionsByCustomer[customer.id] || []).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 text-sm text-teal-700">
                          <span className="text-gray-700">{entry.description}</span>
                          <span className="text-xs text-gray-400">{new Date(entry.created_at).toLocaleDateString()}</span>
                          <span className={`font-semibold ${entry.type === 'return_credit' || entry.type === 'topup' || entry.type === 'refund' ? 'text-emerald-700' : 'text-teal-700'}`}>
                            {entry.type === 'return_credit' || entry.type === 'topup' || entry.type === 'refund' || (entry.type === 'adjustment' && !String(entry.description || '').startsWith('Debit')) ? '+' : '−'}{money(entry.amount)}
                          </span>
                          <span className="text-xs text-gray-400">wallet {money(entry.balance_after)}</span>
                        </div>
                      ))}
                      {(returnsByCustomer[customer.id] || [])
                        .filter((saleReturn) => saleReturn.refund_method === 'account')
                        .map((saleReturn) => (
                          <div key={saleReturn.id} className="flex items-center justify-between gap-3 text-sm text-amber-700">
                            <span className="text-gray-700">
                              Return adjustment · {saleReturn.receipt_number}
                            </span>
                            <span className="text-xs text-gray-400">{new Date(saleReturn.created_at).toLocaleDateString()}</span>
                            <span className="font-semibold text-amber-700">
                              Debt −{money(saleReturn.debt_applied)}
                            </span>
                            {saleReturn.wallet_credit > 0 && (
                              <span className="text-xs text-emerald-600">wallet +{money(saleReturn.wallet_credit)}</span>
                            )}
                          </div>
                        ))}
                      {customerSales.length === 0 && (Number(customer.opening_balance) || 0) <= 0 && (
                        <div className="flex items-center gap-2 py-2 rounded-xl bg-gray-50 px-3">
                          <Clock className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500">No credit balance or credit sales recorded.</span>
                        </div>
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
    {isFormOpen && createPortal(
      <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
        <button
          type="button"
          aria-label="Dismiss customer form"
          className="absolute inset-0 bg-slate-900/50"
          onClick={() => {
            if (saving || formDirty) return;
            resetForm();
          }}
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-form-title"
          className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const root = dialogRef.current;
            if (!root) return;
            const focusable = Array.from(root.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
            ));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveCustomer();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="customer-form-title" className="font-semibold text-gray-900">
                {editing ? 'Edit customer' : 'Register customer'}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Only the name is required. Phone, address, and a starting balance can wait.
            </p>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            <label className="block text-sm font-medium text-gray-700">
              Customer name <span className="text-red-500">*</span>
              <input
                ref={nameInputRef}
                required
                maxLength={255}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Phone <span className="text-gray-400 text-xs">(optional)</span>
              <input
                type="tel"
                inputMode="tel"
                maxLength={30}
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={fieldClass}
              />
            </label>
            <fieldset className="space-y-3 rounded-xl border border-gray-100 p-3">
              <legend className="px-1 text-sm font-medium text-gray-700">
                Customer address <span className="text-gray-400 text-xs">(optional)</span>
              </legend>
              <label className="block text-sm font-medium text-gray-700">
                Street, house, or area
                <input
                  maxLength={200}
                  autoComplete="street-address"
                  value={street}
                  onChange={(event) => setStreet(event.target.value)}
                  placeholder="House number, street, or neighborhood"
                  className={fieldClass}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  City / town
                  <input
                    maxLength={80}
                    autoComplete="address-level2"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder="Accra"
                    className={fieldClass}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Region
                  <input
                    maxLength={80}
                    autoComplete="address-level1"
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    placeholder="Greater Accra"
                    className={fieldClass}
                  />
                </label>
              </div>
            </fieldset>
            {locations.length > 0 && (
              <label className="block text-sm font-medium text-gray-700">
                Preferred location
                <select
                  value={locationId || ''}
                  onChange={(event) => setLocationId(event.target.value || null)}
                  className={fieldClass}
                >
                  <option value="">None (default)</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.location_type})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!editing && (
              <label className="block text-sm font-medium text-gray-700">
                Starting account balance <span className="text-gray-400 text-xs">(optional)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                />
                <span className="mt-1 block text-xs text-gray-400">
                  Credit that is not already a credit sale. It is added to the account balance.
                </span>
              </label>
            )}
            </div>
            <div
              className="space-y-2 border-t border-gray-100 bg-white p-4"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-11 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 touch-target"
              >
                {saving ? 'Saving…' : editing ? 'Save customer' : 'Register customer'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="w-full min-h-11 rounded-xl border border-gray-200 px-4 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 touch-target"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

class CustomerPageBoundary extends Component<{ children: ReactNode }, { error: string; nonce: number }> {
  state = { error: '', nonce: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'The customer page hit a problem.' };
  }

  componentDidCatch(error: unknown) {
    console.error('[Customers] Page render failed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-shell">
          <div className="page-body">
            <div role="alert" className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
              <h1 className="font-semibold text-gray-900">Customer page stopped</h1>
              <p className="mt-2 text-sm text-gray-600">{this.state.error}</p>
              <button
                type="button"
                className="mt-4 min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white touch-target"
                onClick={() => this.setState((current) => ({ error: '', nonce: current.nonce + 1 }))}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <div key={this.state.nonce} className="flex h-full min-h-0 flex-col">{this.props.children}</div>;
  }
}

export default function CustomersPage(props: CustomersPageProps = {}) {
  return (
    <CustomerPageBoundary>
      <CustomersPageView {...props} />
    </CustomerPageBoundary>
  );
}

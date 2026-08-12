import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, AlertCircle, Mail, MessageCircle, Phone,
  RefreshCcw, Loader2, Headphones, CreditCard,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  formatSubscriptionDate,
  getSubscriptionInfo,
  subscriptionStatusLabel,
} from '@/lib/subscription';
import {
  loadAdminContactInfo,
  normalizeGhanaPhone,
  type AdminContactInfo,
} from '@/lib/platformSettings';
import { syncFromSupabase } from '@/lib/dexie';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  generatePaystackReference,
  initializePaystack,
  isPaystackConfigured,
  resolvePaystackEmail,
} from '@/lib/paystack';
import {
  SUBSCRIPTION_PACKAGES,
  formatGhsAmount,
  getBillableUnits,
  priceForPackage,
  type SubscriptionPackage,
} from '@/lib/subscriptionPricing';
import {
  buildSubscriptionPaystackMetadata,
  completeSubscriptionPayment,
} from '@/lib/subscriptionPayments';

/**
 * Store-side subscription: self-serve Paystack renew + customer care contacts.
 */
export default function SubscriptionPage() {
  const { currentStore, currentUser, refreshStore } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const [contact, setContact] = useState<AdminContactInfo>({ whatsapp: '', email: '' });
  const [loadingContact, setLoadingContact] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const info = useMemo(
    () =>
      getSubscriptionInfo(
        currentStore?.subscription_expires_at,
        currentStore?.subscription_started_at
      ),
    [currentStore?.subscription_expires_at, currentStore?.subscription_started_at]
  );

  const billable = useMemo(
    () =>
      getBillableUnits({
        max_shops: currentStore?.max_shops,
        max_warehouses: currentStore?.max_warehouses,
      }),
    [currentStore?.max_shops, currentStore?.max_warehouses]
  );

  const loadContact = useCallback(async () => {
    setLoadingContact(true);
    const data = await loadAdminContactInfo();
    setContact(data);
    setLoadingContact(false);
  }, []);

  useEffect(() => {
    void loadContact();
  }, [loadContact]);

  const flash = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setStatusMsg('');
    } else {
      setStatusMsg(msg);
      setErrorMsg('');
    }
    setTimeout(() => {
      setStatusMsg('');
      setErrorMsg('');
    }, 6000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isSupabaseConfigured()) {
        await syncFromSupabase();
      }
      await refreshStore();
      await loadContact();
      flash('Subscription status updated.');
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Could not refresh status', true);
    }
    setRefreshing(false);
  };

  const handlePay = async (pkg: SubscriptionPackage) => {
    if (!isOwner) {
      flash('Only the store owner can renew the subscription.', true);
      return;
    }
    if (!currentStore) {
      flash('No store selected.', true);
      return;
    }
    if (!isPaystackConfigured()) {
      flash('Paystack is not configured. Contact customer care.', true);
      return;
    }
    if (!isSupabaseConfigured()) {
      flash('Cloud sync is required to activate paid plans.', true);
      return;
    }

    const priced = priceForPackage(pkg, billable.units);
    const reference = generatePaystackReference();
    setPayingId(pkg.id);
    setErrorMsg('');
    setStatusMsg('');

    try {
      await initializePaystack({
        email: resolvePaystackEmail(undefined, reference),
        amount: priced.pesewas,
        reference,
        paymentFor: 'Subscription',
        metadata: buildSubscriptionPaystackMetadata(currentStore, pkg, priced.units),
        onSuccess: (ref) => {
          void (async () => {
            try {
              const result = await completeSubscriptionPayment({
                store: currentStore,
                packageId: pkg.id,
                paystackReference: ref,
                ownerPhone: currentUser?.phone || currentStore.support_number || '',
              });
              if (!result.success) {
                flash(result.error || 'Payment received but activation failed. Contact customer care with your Paystack reference.', true);
              } else {
                await refreshStore();
                if (isSupabaseConfigured()) await syncFromSupabase();
                await refreshStore();
                flash(
                  result.alreadyProcessed
                    ? 'This payment was already applied.'
                    : `Payment successful. Plan extended${
                        result.expiresAt
                          ? ` until ${formatSubscriptionDate(result.expiresAt)}`
                          : ''
                      }.`
                );
              }
            } catch (err: unknown) {
              flash(
                err instanceof Error
                  ? err.message
                  : 'Payment received but activation failed. Contact customer care.',
                true
              );
            }
            setPayingId(null);
          })();
        },
        onClose: () => {
          setPayingId(null);
        },
      });
    } catch (err: unknown) {
      setPayingId(null);
      flash(err instanceof Error ? err.message : 'Could not start Paystack payment', true);
    }
  };

  const whatsappDigits = normalizeGhanaPhone(contact.whatsapp);
  const careMessage = encodeURIComponent(
    `Hello Adimat customer care, I need help with my store "${currentStore?.name || 'my store'}". ` +
      `Plan status: ${subscriptionStatusLabel(info.status)}` +
      (info.expiresAt ? ` (expires ${formatSubscriptionDate(info.expiresAt)})` : '') +
      `. — ${currentUser?.name || 'Store user'}`
  );

  const statusColor =
    info.status === 'active'
      ? info.isExpiringSoon
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : info.status === 'expired'
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <div className="page-shell">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">Subscription</h1>
          <p className="text-emerald-200 text-xs">Pay online and renew instantly</p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          className="p-2.5 rounded-xl bg-white/20 text-white touch-target"
          title="Refresh status"
        >
          <RefreshCcw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="page-body no-scrollbar space-y-3 md:max-w-3xl md:mx-auto md:w-full">
        {statusMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-xs">
            {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-xs">
            {errorMsg}
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${statusColor}`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center flex-shrink-0">
              {info.status === 'active' && !info.isExpiringSoon ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Plan status</p>
              <p className="text-xl font-bold mt-0.5">
                {subscriptionStatusLabel(info.status)}
                {info.isExpiringSoon ? ' · Ending soon' : ''}
              </p>
              <p className="text-sm mt-1 opacity-90">{currentStore?.name || 'Your store'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="bg-white/60 rounded-xl p-3">
              <p className="text-[10px] uppercase font-semibold opacity-70">Started</p>
              <p className="text-sm font-semibold mt-0.5">{formatSubscriptionDate(info.startedAt)}</p>
            </div>
            <div className="bg-white/60 rounded-xl p-3">
              <p className="text-[10px] uppercase font-semibold opacity-70">Expires</p>
              <p className="text-sm font-semibold mt-0.5">{formatSubscriptionDate(info.expiresAt)}</p>
            </div>
            <div className="bg-white/60 rounded-xl p-3">
              <p className="text-[10px] uppercase font-semibold opacity-70">Days left</p>
              <p className="text-sm font-semibold mt-0.5">
                {info.daysLeft == null ? '—' : info.daysLeft}
              </p>
            </div>
            <div className="bg-white/60 rounded-xl p-3">
              <p className="text-[10px] uppercase font-semibold opacity-70">Months granted</p>
              <p className="text-sm font-semibold mt-0.5">
                {currentStore?.subscription_months_granted ?? 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-gray-900">Choose a plan</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Prices are for one shop. Your account is billed for{' '}
            <span className="font-semibold text-gray-800">
              {billable.shops} shop{billable.shops === 1 ? '' : 's'}
              {billable.warehouses > 0
                ? ` + ${billable.warehouses} warehouse${billable.warehouses === 1 ? '' : 's'}`
                : ''}
            </span>{' '}
            (×{billable.units}). Annual plans already include two months free per year. After Paystack
            confirms payment, your plan updates automatically.
          </p>

          {!isOwner && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Only the store owner can pay to renew. Ask the owner to open Plan and complete payment.
            </div>
          )}

          {!isPaystackConfigured() && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Online payment is not configured on this installation. Use Customer care below.
            </div>
          )}

          <div className="space-y-2">
            {SUBSCRIPTION_PACKAGES.map((pkg) => {
              const priced = priceForPackage(pkg, billable.units);
              const busy = payingId === pkg.id;
              return (
                <div
                  key={pkg.id}
                  className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-3 flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 text-sm">{pkg.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {formatGhsAmount(pkg.baseGhs)} × {priced.units} ={' '}
                      <span className="font-semibold text-gray-800">{formatGhsAmount(priced.ghs)}</span>
                    </p>
                    {pkg.saveNote && (
                      <p className="text-[11px] text-emerald-700 font-medium mt-0.5">{pkg.saveNote}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!isOwner || !!payingId || !isPaystackConfigured()}
                    onClick={() => void handlePay(pkg)}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-bold text-white touch-target disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Pay'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Headphones className="w-5 h-5 text-slate-700" />
            <h2 className="font-bold text-gray-900">Customer care</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Reach out only if you need help with payment, billing, or account support.
          </p>

          {loadingContact ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading contact details…
            </div>
          ) : !whatsappDigits && !contact.email ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs">
              Customer care contacts are not set yet. Ask the platform administrator to add WhatsApp
              and email under Admin → Contact.
            </div>
          ) : (
            <div className="space-y-2">
              {whatsappDigits && (
                <a
                  href={`https://wa.me/${whatsappDigits}?text=${careMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 touch-target"
                >
                  <MessageCircle className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">WhatsApp support</p>
                    <p className="text-xs opacity-80 truncate">+{whatsappDigits}</p>
                  </div>
                </a>
              )}

              {contact.whatsapp && (
                <a
                  href={`tel:${contact.whatsapp}`}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 touch-target"
                >
                  <Phone className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">Call support</p>
                    <p className="text-xs text-gray-500 truncate">{contact.whatsapp}</p>
                  </div>
                </a>
              )}

              {contact.email && (
                <a
                  href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(
                    `Adimat customer care — ${currentStore?.name || 'Store'}`
                  )}&body=${careMessage}`}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 touch-target"
                >
                  <Mail className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">Email support</p>
                    <p className="text-xs opacity-80 truncate">{contact.email}</p>
                  </div>
                </a>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-500 text-center px-4 pb-2">
          Signed in as {currentUser?.name} ({currentUser?.role}).
        </p>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import type { LocalStore } from '@/lib/dexie';
import { formatSubscriptionDate } from '@/lib/subscription';
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
import { isSupabaseConfigured } from '@/lib/supabase';

interface SubscriptionPackagesCardProps {
  store: LocalStore;
  isOwner: boolean;
  ownerPhone?: string;
  title?: string;
  intro?: string;
  onActivated?: (expiresAt?: string) => Promise<void> | void;
}

/**
 * Self-serve Paystack packages. Used on Plan and on the store-access paywall.
 */
export default function SubscriptionPackagesCard({
  store,
  isOwner,
  ownerPhone,
  title = 'Choose a plan',
  intro,
  onActivated,
}: SubscriptionPackagesCardProps) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const billable = useMemo(
    () =>
      getBillableUnits({
        max_shops: store.max_shops,
        max_warehouses: store.max_warehouses,
      }),
    [store.max_shops, store.max_warehouses]
  );

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

  const handlePay = async (pkg: SubscriptionPackage) => {
    if (!isOwner) {
      flash('Only the store owner can renew the subscription.', true);
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
        metadata: buildSubscriptionPaystackMetadata(store, pkg, priced.units),
        onSuccess: (ref) => {
          void (async () => {
            try {
              const result = await completeSubscriptionPayment({
                store,
                packageId: pkg.id,
                paystackReference: ref,
                ownerPhone: ownerPhone || store.support_number || '',
              });
              if (!result.success) {
                flash(
                  result.error ||
                    'Payment received but activation failed. Contact customer care with your Paystack reference.',
                  true
                );
              } else {
                await onActivated?.(result.expiresAt);
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

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard className="w-5 h-5 text-primary" />
        <h2 className="font-bold text-gray-900">{title}</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        {intro || (
          <>
            Prices are for one shop. Your account is billed for{' '}
            <span className="font-semibold text-gray-800">
              {billable.shops} shop{billable.shops === 1 ? '' : 's'}
              {billable.warehouses > 0
                ? ` + ${billable.warehouses} warehouse${billable.warehouses === 1 ? '' : 's'}`
                : ''}
            </span>{' '}
            (×{billable.units}). Annual plans already include two months free per year. After Paystack
            confirms payment, your plan updates automatically.
          </>
        )}
      </p>

      {statusMsg && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-xs">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-xs">
          {errorMsg}
        </div>
      )}

      {!isOwner && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Only the store owner can pay to renew. Ask the owner to sign in and complete payment.
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
  );
}

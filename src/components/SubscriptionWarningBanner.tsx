import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { getCurrentStore } from '@/lib/dexie';
import {
  formatSubscriptionDate,
  getSubscriptionInfo,
  type SubscriptionInfo,
} from '@/lib/subscription';

interface SubscriptionWarningBannerProps {
  onOpenPlan?: () => void;
}

/**
 * Shows a simple warning when the store subscription is expiring soon or expired.
 * Store owners/cashiers can open the Plan tab to contact the administrator.
 */
export default function SubscriptionWarningBanner({ onOpenPlan }: SubscriptionWarningBannerProps) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const store = await getCurrentStore();
      if (cancelled) return;
      if (!store) {
        setInfo(null);
        return;
      }
      setInfo(
        getSubscriptionInfo(store.subscription_expires_at, store.subscription_started_at)
      );
    };

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!info?.shouldWarn || !info.expiresAt) return null;

  const dismissKey = `${info.status}:${info.expiresAt}`;
  if (dismissedKey === dismissKey) return null;

  const isExpired = info.isExpired;
  const daysText =
    info.daysLeft == null
      ? ''
      : isExpired
        ? info.daysLeft === 0
          ? 'today'
          : `${Math.abs(info.daysLeft)} day${Math.abs(info.daysLeft) === 1 ? '' : 's'} ago`
        : `in ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`;

  return (
    <div
      className={`flex-shrink-0 px-3 py-2.5 flex items-start gap-2 ${
        isExpired
          ? 'bg-red-600 text-white'
          : 'bg-amber-500 text-amber-950'
      }`}
      role="status"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-xs leading-snug">
        {isExpired ? (
          <p>
            <span className="font-bold">Subscription expired</span>
            {daysText ? ` (${daysText})` : ''}. Open Plan to contact the system administrator to renew.
          </p>
        ) : (
          <p>
            <span className="font-bold">Subscription ending soon</span>
            {daysText ? ` — expires ${daysText}` : ''} (
            {formatSubscriptionDate(info.expiresAt)}). Open Plan to renew with the administrator.
          </p>
        )}
        {onOpenPlan && (
          <button
            type="button"
            onClick={onOpenPlan}
            className="mt-1.5 underline font-semibold"
          >
            Open Plan
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissedKey(dismissKey)}
        className="p-1 rounded-lg opacity-80 hover:opacity-100 touch-target flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useT } from '@/lib/i18n';
import {
  getLastActivityAt,
  getRemainingMs,
  isSessionIdle,
  markIdleLock,
  normalizeSessionTimeoutMinutes,
  SESSION_TIMEOUT_WARNING_MS,
  touchLastActivity,
} from '@/lib/sessionTimeout';

function lockDueToInactivity() {
  markIdleLock();
  useCartStore.getState().clearCart();
  useAuthStore.getState().switchUser();
}

/**
 * While a store user is signed in, lock the till after idle time.
 * Last activity is persisted so a refresh cannot restore a stale session.
 */
export default function SessionTimeoutGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentStore = useAuthStore((s) => s.currentStore);
  const t = useT();
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const lockingRef = useRef(false);

  const storeId = currentStore?.id;
  const timeoutMinutes = normalizeSessionTimeoutMinutes(currentStore?.session_timeout_minutes);

  useEffect(() => {
    lockingRef.current = false;
    if (!isAuthenticated || !storeId || timeoutMinutes <= 0) {
      setWarningSeconds(null);
      return;
    }

    if (getLastActivityAt(storeId) == null) {
      touchLastActivity(storeId);
    }

    const onActivity = () => {
      if (lockingRef.current) return;
      touchLastActivity(storeId);
      setWarningSeconds(null);
    };

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'click',
      'wheel',
    ];
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));

    const tick = () => {
      if (lockingRef.current) return;
      if (isSessionIdle(storeId, timeoutMinutes)) {
        lockingRef.current = true;
        setWarningSeconds(null);
        lockDueToInactivity();
        return;
      }
      const remaining = getRemainingMs(storeId, timeoutMinutes);
      if (remaining != null && remaining <= SESSION_TIMEOUT_WARNING_MS) {
        setWarningSeconds(Math.max(1, Math.ceil(remaining / 1000)));
      } else {
        setWarningSeconds(null);
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated, storeId, timeoutMinutes]);

  if (warningSeconds == null) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/70 p-4 animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-body"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 mb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Timer className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h2 id="session-timeout-title" className="font-bold text-gray-900">
              {t('session.idleTitle')}
            </h2>
            <p className="text-xs text-gray-500">{t('session.idleCountdown', { seconds: warningSeconds })}</p>
          </div>
        </div>
        <p id="session-timeout-body" className="text-sm text-gray-600 mb-4">
          {t('session.idleBody')}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!storeId) return;
            touchLastActivity(storeId);
            setWarningSeconds(null);
          }}
          className="w-full py-3 bg-primary text-white rounded-xl font-semibold text-sm touch-target"
        >
          {t('session.staySignedIn')}
        </button>
      </div>
    </div>
  );
}

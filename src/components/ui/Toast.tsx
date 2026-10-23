import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

type SyncPhase = 'start' | 'complete' | 'error';

interface SyncEventDetail {
  phase?: SyncPhase;
  success?: boolean;
  message?: string;
  reason?: string;
}

interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

export function SyncToast() {
  const t = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev, { id, ...item }]);
      setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 6000);
    },
    []
  );

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail ?? {};
      if (detail.phase === 'complete' && detail.success) {
        add({
          type: 'success',
          title: t('sync.notify.title'),
          message: detail.message || t('sync.notify.message'),
        });
      } else if (detail.phase === 'error') {
        add({
          type: 'error',
          title: t('sync.notify.errorTitle'),
          message: detail.message || t('sync.notify.errorMessage'),
        });
      } else if (detail.phase === 'start') {
        add({
          type: 'info',
          title: t('sync.notify.syncingTitle'),
          message: t('sync.notify.syncingMessage'),
        });
      }
    };
    window.addEventListener('adimat-sync', onSync);
    return () => window.removeEventListener('adimat-sync', onSync);
  }, [add, t]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-5"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border border-black/5 bg-white/90 p-3 text-ink shadow-[0_12px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl animate-fade-in"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-success" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-danger" />
          ) : (
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0 text-primary" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold tracking-tight">{toast.title}</p>
            <p className="text-[13px] mt-0.5 leading-relaxed text-muted">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="ml-2 flex-shrink-0 p-1 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-100"
            aria-label="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

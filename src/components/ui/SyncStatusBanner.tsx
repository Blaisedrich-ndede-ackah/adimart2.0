import { useEffect, useState } from 'react';
import { WifiOff, AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { syncNow } from '@/lib/sync';

type SyncStatus = 'online' | 'syncing' | 'offline' | 'error';

export function SyncStatusBanner() {
  const t = useT();
  const [status, setStatus] = useState<SyncStatus>('online');
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setStatus(navigator.onLine ? 'online' : 'offline');
    const onOnline = () => setStatus((current) => (current === 'syncing' ? current : 'online'));
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail.phase === 'start') setStatus('syncing');
      else if (detail.phase === 'complete' && detail.success !== false) {
        setStatus(navigator.onLine ? 'online' : 'offline');
        setMessage('');
      } else if (detail.phase === 'error' || detail.success === false) {
        setStatus(navigator.onLine ? 'error' : 'offline');
        setMessage(String(detail.message || ''));
      }
    };
    const onPending = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (typeof detail.count === 'number') setPending(detail.count);
    };
    window.addEventListener('adimat-sync', onSync);
    window.addEventListener('adimat-sync-pending', onPending);
    return () => {
      window.removeEventListener('adimat-sync', onSync);
      window.removeEventListener('adimat-sync-pending', onPending);
    };
  }, []);

  if (status !== 'offline' && status !== 'error') return null;

  const label = status === 'error'
    ? t('sync.status.error')
    : t('sync.status.offline', { count: pending });

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      aria-live="polite"
      data-status={status}
      className="sync-banner flex min-h-11 w-full items-center gap-2 border-b border-black/5 bg-[#FFF4E5] px-4 py-2 text-left text-[13px] font-medium text-[#C2410C]"
      title={message || t('sync.status.now')}
    >
      {status === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      <span>{label}</span>
      <span className="ml-auto text-[12px] font-semibold">{t('sync.status.now')}</span>
    </button>
  );
}

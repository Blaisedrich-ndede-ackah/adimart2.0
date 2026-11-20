import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

type SyncStatus = 'idle' | 'syncing' | 'online' | 'offline';

export function SyncStatusBanner() {
  const [status, setStatus] = useState<SyncStatus>('online');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setStatus(navigator.onLine ? 'online' : 'offline');
    const onOnline = () => setStatus('online');
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Listen for sync events dispatched by the sync layer
  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail.phase === 'start') {
        setStatus('syncing');
      } else if (detail.phase === 'complete') {
        setStatus(navigator.onLine ? 'online' : 'offline');
      } else if (detail.phase === 'error') {
        setStatus('offline');
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

  if (status !== 'offline') return null;

  return (
    <div className="flex items-center gap-2 border-b border-black/5 bg-[#FFF4E5] px-4 py-1.5 text-[13px] font-medium text-[#C2410C]">
      <WifiOff className="h-3.5 w-3.5" />
      <span>
        Offline{pending > 0 ? ` · ${pending} sale(s) pending sync` : ''}
      </span>
    </div>
  );
}
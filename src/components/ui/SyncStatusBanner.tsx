import { useEffect, useState } from 'react';
import { Radio, WifiOff, Loader2, CheckCircle2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

type SyncStatus = 'idle' | 'syncing' | 'online' | 'offline';

export function SyncStatusBanner() {
  const t = useT();
  const [status, setStatus] = useState<SyncStatus>('online');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
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
        setStatus('online');
        setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
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

  if (status === 'syncing') {
    return (
      <div className="flex items-center gap-2 border-b border-black/5 bg-[#E5F1FF] px-4 py-1.5 text-[13px] font-medium text-[#007AFF]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Syncing with cloud…</span>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="flex items-center gap-2 border-b border-black/5 bg-[#FFF4E5] px-4 py-1.5 text-[13px] font-medium text-[#C2410C]">
        <WifiOff className="h-3.5 w-3.5" />
        <span>
          Offline{pending > 0 ? ` · ${pending} sale(s) pending sync` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-black/5 bg-white/70 px-4 py-1 text-[12px] font-medium text-muted">
      <Radio className="h-3.5 w-3.5" />
      <span>
        Online{lastSynced ? ` · synced ${lastSynced}` : ''}
      </span>
    </div>
  );
}
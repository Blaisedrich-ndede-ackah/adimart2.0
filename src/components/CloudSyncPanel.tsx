import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCcw, WifiOff } from 'lucide-react';
import {
  getCurrentStoreId,
  getLastSyncTime,
  syncBidirectional,
  syncFromSupabase,
  syncToSupabase,
} from '@/lib/dexie';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isAutoSyncEnabled, recordSyncOutcome, setAutoSyncEnabled, startAutoSync, stopAutoSync } from '@/lib/sync';
import { useAuthStore } from '@/store/useAuthStore';
import { useT } from '@/lib/i18n';

type SyncMode = 'push' | 'pull' | 'full';

interface CloudSyncPanelProps {
  /** Show the Store ID (owners restoring on another device). */
  showStoreId?: boolean;
  /** Extra copy under the title — used for cashiers. */
  hint?: string;
  /** Called after a successful sync so the host page can reload lists. */
  onSynced?: () => void | Promise<void>;
}

export default function CloudSyncPanel({
  showStoreId = false,
  hint,
  onSynced,
}: CloudSyncPanelProps) {
  const t = useT();
  const { refreshStore } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [autoSync, setAutoSync] = useState(isAutoSyncEnabled());
  const [storeId, setStoreId] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    setSupabaseReady(isSupabaseConfigured());
    setLastSync(await getLastSyncTime());
    setAutoSync(isAutoSyncEnabled());
    if (showStoreId) setStoreId(await getCurrentStoreId());
  }, [showStoreId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const handleSync = async (mode: SyncMode = 'full') => {
    if (!isSupabaseConfigured()) {
      setSyncStatus(t('sync.notConfigured'));
      return;
    }

    setIsSyncing(true);
    setSyncStatus(
      mode === 'pull' ? t('sync.pulling') : mode === 'push' ? t('sync.pushing') : t('sync.running')
    );

    try {
      const result =
        mode === 'pull'
          ? await syncFromSupabase()
          : mode === 'full'
            ? await syncBidirectional()
            : await syncToSupabase();
      recordSyncOutcome(result);
      setSyncStatus(result.message);

      if (result.success) {
        setLastSync(await getLastSyncTime());
        await refreshStore();
        await onSynced?.();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      recordSyncOutcome({ success: false, message: msg });
      setSyncStatus(`${t('sync.errorPrefix')} ${msg}`);
    }

    setIsSyncing(false);
    setTimeout(() => setSyncStatus(''), 8000);
  };

  const handleAutoSyncToggle = (enabled: boolean) => {
    setAutoSync(enabled);
    setAutoSyncEnabled(enabled);
    if (enabled) {
      startAutoSync();
      setSyncStatus(t('sync.autoOn'));
    } else {
      stopAutoSync();
      setSyncStatus(t('sync.autoOff'));
    }
    setTimeout(() => setSyncStatus(''), 4000);
  };

  const statusIsError =
    /issue|partial|error|failed|not configured/i.test(syncStatus);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCcw className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-gray-900">{t('sync.title')}</h3>
      </div>
      {hint && <p className="text-xs text-gray-500 mb-3 leading-relaxed">{hint}</p>}

      {!supabaseReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
          <p className="text-amber-800 text-xs">{t('sync.notConfigured')}</p>
        </div>
      )}

      {showStoreId && storeId && (
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          <p className="text-[10px] text-gray-500 mb-1">{t('sync.storeIdHint')}</p>
          <p className="text-xs font-mono text-gray-800 break-all">{storeId}</p>
        </div>
      )}

      <label className="flex items-center justify-between py-2 mb-3">
        <span className="text-sm text-gray-700">{t('sync.auto')}</span>
        <button
          type="button"
          onClick={() => handleAutoSyncToggle(!autoSync)}
          className={`w-12 h-7 rounded-full transition-colors ${autoSync ? 'bg-primary' : 'bg-gray-300'}`}
          aria-pressed={autoSync}
        >
          <span
            className={`block w-5 h-5 bg-white rounded-full transition-transform mx-1 ${
              autoSync ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </label>

      <div className="grid grid-cols-1 gap-2 mb-2">
        <button
          type="button"
          onClick={() => void handleSync('full')}
          disabled={isSyncing}
          className="w-full py-3 bg-primary text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50 touch-target"
        >
          {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          {t('sync.full')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleSync('pull')}
            disabled={isSyncing}
            className="py-3 border border-primary text-primary rounded-xl font-medium text-xs disabled:opacity-50 touch-target"
          >
            {t('sync.pull')}
          </button>
          <button
            type="button"
            onClick={() => void handleSync('push')}
            disabled={isSyncing}
            className="py-3 border border-gray-300 text-gray-700 rounded-xl font-medium text-xs disabled:opacity-50 touch-target"
          >
            {t('sync.push')}
          </button>
        </div>
      </div>

      {syncStatus && (
        <p className={`text-xs mt-2 text-center ${statusIsError ? 'text-amber-600' : 'text-green-600'}`}>
          {syncStatus}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-3 justify-center">
        {lastSync ? (
          <>
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-gray-500">
              {t('sync.lastSynced')}: {new Date(lastSync).toLocaleString()}
            </span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] text-gray-500">{t('sync.never')}</span>
          </>
        )}
      </div>
    </div>
  );
}

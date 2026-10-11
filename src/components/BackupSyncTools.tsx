import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Archive, Download, RefreshCw, Upload } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  createAutomaticStoreBackup,
  exportLatestAutomaticBackup,
  exportStoreBackup,
  getLatestAutomaticBackup,
  getStoreSyncHealth,
  recordBackupIssue,
  restoreStoreBackup,
} from '@/lib/storeBackup';

export default function BackupSyncTools() {
  const { currentStore } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getStoreSyncHealth>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    if (!currentStore?.id) return;
    try {
      await createAutomaticStoreBackup(currentStore.id);
      recordBackupIssue('');
      const [backup, syncHealth] = await Promise.all([
        getLatestAutomaticBackup(currentStore.id),
        getStoreSyncHealth(currentStore.id),
      ]);
      setBackupAt(backup?.created_at || null);
      setHealth(syncHealth);
    } catch (error) {
      console.error('[Backup] Could not create/read automatic backup:', error);
      const message = error instanceof Error ? error.message : 'Could not prepare the local backup.';
      recordBackupIssue(message);
      setStatus(message);
    }
  }, [currentStore?.id]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadBackup = async (automatic: boolean) => {
    if (!currentStore?.id) return;
    setBusy(true);
    setStatus('');
    try {
      const blob = automatic
        ? await exportLatestAutomaticBackup(currentStore.id)
        : await exportStoreBackup(currentStore.id);
      downloadBlob(blob, `adimat-${currentStore.id}-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setStatus('Backup downloaded. Store it somewhere separate from this device.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not export backup.');
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (file?: File) => {
    if (!file || !currentStore?.id) return;
    if (!confirm('Restoring replaces this device’s current local data for this store with the selected backup. Unsynced rows in the backup may be uploaded on the next cloud sync. This cannot be undone. Continue?')) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await restoreStoreBackup(file, currentStore.id);
      setStatus('Backup restored. Reloading the app…');
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not restore backup.');
      setBusy(false);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Archive className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-gray-900">Backup & sync health</h3>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-xs text-gray-700">
        <p><strong>Automatic on-device backup:</strong> {backupAt ? new Date(backupAt).toLocaleString() : 'Preparing…'}</p>
        <p className="mt-1 text-gray-500">A daily snapshot is kept in this browser (up to 7 snapshots). Download a copy to protect against device loss or browser data being cleared. Backup files contain sensitive store and staff data, including PIN hashes; keep them private.</p>
      </div>
      {health && (
        <div className="mt-3 space-y-1 rounded-lg border border-gray-100 p-3 text-xs">
          <p><strong>Connection:</strong> {health.online ? 'Online' : 'Offline'}</p>
          <p><strong>Pending local changes:</strong> {health.pendingCount}</p>
          <p><strong>Last successful sync:</strong> {health.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString() : 'No successful sync recorded'}</p>
          {health.lastError && <p className="break-words text-amber-800"><strong>Last sync issue:</strong> {health.lastError}</p>}
          {health.backupError && <p className="break-words text-amber-800"><strong>Last backup issue:</strong> {health.backupError}</p>}
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button type="button" disabled={busy} onClick={() => void downloadBackup(false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-xs font-semibold text-white disabled:opacity-50 touch-target">
          <Download className="h-4 w-4" /> Download backup
        </button>
        <button type="button" disabled={busy || !backupAt} onClick={() => void downloadBackup(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary px-3 py-3 text-xs font-semibold text-primary disabled:opacity-50 touch-target">
          <Archive className="h-4 w-4" /> Download snapshot
        </button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-xs font-semibold text-gray-700 disabled:opacity-50 touch-target">
          <Upload className="h-4 w-4" /> Restore backup
        </button>
        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void restoreBackup(event.target.files?.[0])} />
      </div>
      <button type="button" onClick={() => void refresh()} disabled={busy} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-gray-600 disabled:opacity-50">
        <RefreshCw className="h-3.5 w-3.5" /> Refresh backup and sync status
      </button>
      {status && <p role="status" className={`mt-2 flex items-start gap-2 text-xs ${/failed|could not|issue/i.test(status) ? 'text-amber-800' : 'text-emerald-700'}`}>
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {status}
      </p>}
    </section>
  );
}

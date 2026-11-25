import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

type NotificationRow = { id: string; type: string; title: string; body: string; data_json: Record<string, unknown>; is_read: boolean; created_at: string };
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
function decodePublicKey(key: string): Uint8Array {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export default function NotificationsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [unreadCount, setUnreadCount] = useState(0);

  const request = useCallback(async (action: string, fields: Record<string, unknown> = {}) => {
    if (!currentStore?.id || !currentUser?.id) throw new Error('Select a store and sign in again.');
    const response = await fetch(`/api/integrations?action=${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store_id: currentStore.id, user_id: currentUser.id, ...fields }) });
    const responseText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch { /* Include a short response preview below for Vercel/proxy HTML errors. */ }
    if (!response.ok) {
      const detail = typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : responseText.trim().slice(0, 240);
      throw new Error(detail ? `Notification request failed (${response.status}): ${detail}` : `Notification request failed (${response.status}).`);
    }
    return data;
  }, [currentStore?.id, currentUser?.id]);

  const load = useCallback(async () => {
    if (!currentStore?.id || !currentUser?.id) return;
    setBusy(true);
    try {
      const result = await request('notification_list');
      setRows(result.notifications || []);
      setUnreadCount(Number(result.unread_count) || 0);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load notifications.'); }
    finally { setBusy(false); }
  }, [currentStore?.id, currentUser?.id, request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!currentStore?.id || !currentUser?.id) return;
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [currentStore?.id, currentUser?.id, load]);
  useEffect(() => {
    let active = true;
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => { if (active) setPushEnabled(Boolean(subscription)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    try {
      await request('notification_read', { ids });
      setRows((old) => old.map((row) => ids.includes(row.id) ? { ...row, is_read: true } : row));
      setUnreadCount((old) => Math.max(0, old - rows.filter((row) => ids.includes(row.id) && !row.is_read).length));
      setStatus(ids.length > 1 ? 'Visible notifications marked as read.' : 'Notification marked as read.');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark notifications as read.'); }
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setPushState('Push notifications are not supported by this browser.'); return; }
    if (!VAPID_PUBLIC_KEY) { setPushState('Push is not configured for this deployment. Set VITE_VAPID_PUBLIC_KEY and the matching server VAPID keys.'); return; }
    setPushState('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setPushState('Browser notification permission was not granted.'); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(VAPID_PUBLIC_KEY).buffer as ArrayBuffer });
      await request('push_subscribe', { subscription: subscription.toJSON(), device_label: navigator.userAgent.slice(0, 120) });
      setPushEnabled(true); setPushState('Push notifications are enabled on this device.');
    } catch (cause) { setPushState(cause instanceof Error ? cause.message : 'Could not enable push notifications.'); }
  }

  async function disablePush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await request('push_unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setPushEnabled(false); setPushState('Push notifications are turned off on this device.');
    } catch (cause) { setPushState(cause instanceof Error ? cause.message : 'Could not turn off push notifications.'); }
  }

  const unreadIds = rows.filter((row) => !row.is_read).map((row) => row.id);
  const visibleRows = filter === 'unread' ? rows.filter((row) => !row.is_read) : rows;
  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-4xl space-y-4 p-4 pb-24 md:p-6">
    <header className="rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-900 p-5 text-white shadow-lg"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200">Store activity</p><h1 className="mt-1 text-2xl font-bold">Notifications</h1><p className="mt-1 text-sm text-white/70">Important alerts for this store and device.</p></div><button type="button" disabled={busy} onClick={() => void load()} className="rounded-full bg-white/15 p-2" aria-label="Refresh notifications"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button></div></header>
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-gray-900">Device push</h2><p className="mt-1 text-xs text-gray-500">Receive store alerts while Adimat is closed. This setting applies to this device.</p></div>{pushEnabled ? <button type="button" onClick={() => void disablePush()} className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700">Turn off on this device</button> : <button type="button" onClick={() => void enablePush()} className="rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white">Enable on this device</button>}</div>{pushState && <p role="status" className="mt-3 text-xs text-indigo-800">{pushState}</p>}</section>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {status && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{status}</p>}
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 font-bold text-gray-900"><Bell className="h-4 w-4 text-indigo-700" />Notifications <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">{unreadCount} unread</span></h2><p className="mt-1 text-xs text-gray-500">Showing the latest 100 alerts. Unread count includes older notifications.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${filter === 'all' ? 'bg-indigo-700 text-white' : 'bg-gray-100 text-gray-700'}`}>All</button><button type="button" onClick={() => setFilter('unread')} aria-pressed={filter === 'unread'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${filter === 'unread' ? 'bg-indigo-700 text-white' : 'bg-gray-100 text-gray-700'}`}>Unread</button>{unreadIds.length > 0 && <button type="button" onClick={() => void markRead(unreadIds)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"><CheckCheck className="h-4 w-4" />Mark visible read</button>}</div></div>
      {busy && rows.length === 0 ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-indigo-700" /></div> : visibleRows.length ? <div className="mt-3 space-y-2">{visibleRows.map((row) => <article key={row.id} className={`rounded-xl border p-3 ${row.is_read ? 'border-gray-100 bg-white' : 'border-indigo-200 bg-indigo-50/60'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-gray-900">{row.title}</p><p className="mt-1 text-sm text-gray-600">{row.body}</p><p className="mt-2 text-[11px] text-gray-400">{new Date(row.created_at).toLocaleString()}</p></div>{!row.is_read && <button type="button" onClick={() => void markRead([row.id])} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-white">Mark read</button>}</div></article>)}</div> : <p className="py-12 text-center text-sm text-gray-500">{filter === 'unread' ? 'No unread notifications.' : 'You are all caught up. New store alerts will appear here.'}</p>}
    </section>
  </div></div>;
}

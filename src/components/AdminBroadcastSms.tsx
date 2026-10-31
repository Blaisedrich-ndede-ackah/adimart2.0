import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Megaphone, Send } from 'lucide-react';
import { sendBulkSmsViaMnotify } from '@/lib/mnotify';
import type { AdminStoreRow, AdminUserRow } from '@/lib/adminPortal';

interface AdminBroadcastSmsProps {
  stores: AdminStoreRow[];
  users: AdminUserRow[];
  unavailable?: string;
}

export default function AdminBroadcastSms({ stores, users, unavailable = '' }: AdminBroadcastSmsProps) {
  const [message, setMessage] = useState('');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const owners = useMemo(() => {
    const ownerByStore = new Map<string, AdminUserRow>();
    users
      .filter((user) => user.role === 'owner' && user.is_active && user.phone.trim())
      .forEach((user) => ownerByStore.set(user.store_id, user));
    return stores
      .filter((store) => ownerByStore.has(store.id))
      .map((store) => ({ store, owner: ownerByStore.get(store.id)! }));
  }, [stores, users]);

  const selectedAll = selectedStoreIds.length === owners.length && owners.length > 0;
  const recipients = owners.filter(({ store }) => selectedStoreIds.includes(store.id));

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((current) =>
      current.includes(storeId) ? current.filter((id) => id !== storeId) : [...current, storeId]
    );
  };

  const sendBroadcast = async () => {
    setNotice('');
    setError('');
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Write a message before sending.');
      return;
    }
    if (trimmed.length > 459) {
      setError('Keep the message within 459 characters.');
      return;
    }
    if (recipients.length === 0) {
      setError('Select at least one store owner.');
      return;
    }
    if (!window.confirm(`Send this SMS to ${recipients.length} store owner${recipients.length === 1 ? '' : 's'}?`)) return;

    setBusy(true);
    try {
      const result = await sendBulkSmsViaMnotify(
        recipients.map(({ owner }) => owner.phone),
        trimmed
      );
      if (!result.success) {
        setError(result.error || 'mNotify could not send the broadcast.');
        return;
      }
      setNotice(`Broadcast sent to ${result.sentCount} store owner${result.sentCount === 1 ? '' : 's'}.`);
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="broadcast-sms-title">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><Megaphone className="h-5 w-5" /></div>
        <div>
          <h2 id="broadcast-sms-title" className="text-xl font-bold text-slate-900">Broadcast SMS</h2>
          <p className="mt-1 text-sm text-slate-500">Send an announcement to active store owners through mNotify.</p>
        </div>
      </div>

      {unavailable && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {unavailable || 'The store list has not loaded yet. Open this tab again after the cloud data arrives.'}
        </p>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label htmlFor="broadcast-message" className="text-sm font-semibold text-slate-800">Message</label>
        <textarea
          id="broadcast-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={459}
          rows={5}
          placeholder="Write your announcement to store owners..."
          className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
        <div className="mt-1 flex justify-end text-xs text-slate-500">{message.length}/459</div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Recipients</h3>
            <p className="text-xs text-slate-500">{recipients.length} of {owners.length} active owners selected</p>
          </div>
          <button type="button" onClick={() => setSelectedStoreIds(selectedAll ? [] : owners.map(({ store }) => store.id))} className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">
            {selectedAll ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {owners.length === 0 ? <p className="p-4 text-sm text-slate-500">No active store owners have a phone number.</p> : owners.map(({ store, owner }) => (
            <label key={store.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <input type="checkbox" checked={selectedStoreIds.includes(store.id)} onChange={() => toggleStore(store.id)} className="h-4 w-4 accent-emerald-700" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{store.name}</span><span className="block text-xs text-slate-500">{owner.name} · {owner.phone}</span></span>
            </label>
          ))}
        </div>

        {error && <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {notice && <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}
        <button type="button" onClick={() => void sendBroadcast()} disabled={busy || recipients.length === 0 || Boolean(unavailable)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? 'Sending...' : 'Send broadcast SMS'}
        </button>
      </div>
    </section>
  );
}

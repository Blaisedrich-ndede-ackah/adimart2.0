import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Megaphone, Send } from 'lucide-react';
import { listBroadcastRecipients } from '@/lib/adminBroadcast';
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

  const owners = useMemo(() => listBroadcastRecipients(stores, users), [stores, users]);
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
    <section className="mx-auto max-w-3xl space-y-4" aria-labelledby="broadcast-sms-title">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-white/70 p-3 text-primary">
          <Megaphone className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">mNotify</p>
          <h2 id="broadcast-sms-title" className="text-xl font-bold text-slate-900">Broadcast SMS</h2>
          <p className="mt-1 text-sm text-slate-600">
            Send one announcement to active store owners. The message goes out through the mNotify key saved on Contact.
          </p>
        </div>
      </div>

      <div className="ios-glass rounded-2xl p-4 sm:p-6">
        <label htmlFor="broadcast-message" className="text-sm font-semibold text-slate-800">Message</label>
        <textarea
          id="broadcast-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={459}
          rows={5}
          placeholder="Write your announcement to store owners..."
          className="mt-2 w-full resize-y rounded-xl border border-white/70 bg-white px-3 py-3 text-sm outline-none"
        />
        <div className="mt-1 flex justify-end text-xs text-slate-500">{message.length}/459</div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Recipients</h3>
            <p className="text-xs text-slate-500">{recipients.length} of {owners.length} active owners selected</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedStoreIds(selectedAll ? [] : owners.map(({ store }) => store.id))}
            className="text-sm font-semibold text-primary"
          >
            {selectedAll ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <div className="mt-3 max-h-64 divide-y divide-black/5 overflow-y-auto rounded-xl border border-white/70 bg-white/80">
          {unavailable ? (
            <p className="p-4 text-sm text-slate-600">The store list has not loaded, so there is nobody to message yet.</p>
          ) : owners.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No active store owners have a phone number.</p>
          ) : owners.map(({ store, owner }) => (
            <label key={store.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selectedStoreIds.includes(store.id)}
                onChange={() => toggleStore(store.id)}
                className="h-4 w-4 accent-emerald-700"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{store.name}</span>
                <span className="block text-xs text-slate-500">{owner.name} · {owner.phone}</span>
              </span>
            </label>
          ))}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}
        <button
          type="button"
          onClick={() => void sendBroadcast()}
          disabled={busy || recipients.length === 0 || Boolean(unavailable)}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 touch-target"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? 'Sending...' : 'Send broadcast SMS'}
        </button>
      </div>
    </section>
  );
}

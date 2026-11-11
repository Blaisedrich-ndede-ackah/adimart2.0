import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCcw, Search, XCircle } from 'lucide-react';
import {
  approvePaystackPayment,
  cancelPaystackPayment,
  loadPendingPaystackPayments,
  type PendingPaystackPayment,
} from '@/lib/adminPaystackApprovals';

const KIND_LABEL: Record<PendingPaystackPayment['kind'], string> = {
  subscription: 'Subscription',
  sms: 'SMS credit',
  shop: 'Shop payment',
  sale: 'POS sale',
};

export default function AdminPaystackApprovals() {
  const [rows, setRows] = useState<PendingPaystackPayment[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadPendingPaystackPayments();
      setRows(result.rows);
      setNotes(result.notes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Paystack payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.reference, row.storeName, row.detail, KIND_LABEL[row.kind]].join(' ').toLowerCase().includes(needle)
    );
  }, [query, rows]);

  async function approve(row: PendingPaystackPayment) {
    const ok = window.confirm(
      `Confirm that Paystack already collected ${row.reference || 'this payment'} for ${row.storeName}? This will apply it in Adimat.`
    );
    if (!ok) return;
    setBusyId(`${row.id}:approve`);
    setError('');
    setMessage('');
    try {
      const result = await approvePaystackPayment(row);
      setMessage(result);
      setRows((current) => current.filter((item) => item.id !== row.id));
      await load();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Could not approve this payment.');
    } finally {
      setBusyId('');
    }
  }

  async function cancel(row: PendingPaystackPayment) {
    const ok = window.confirm(
      `Cancel ${row.reference || 'this payment'} for ${row.storeName}? It leaves this list and does not add a subscription, SMS credit, shop wallet, or completed sale.`
    );
    if (!ok) return;
    setBusyId(`${row.id}:cancel`);
    setError('');
    setMessage('');
    try {
      const result = await cancelPaystackPayment(row);
      setMessage(result);
      setRows((current) => current.filter((item) => item.id !== row.id));
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel this payment.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        Use this when a customer or store has paid on Paystack but Adimat did not update the subscription, SMS units, shop wallet, or sale. Approving applies that payment. Cancel removes it from this list and does not add anything. Check the Paystack dashboard first.
      </div>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reference or store"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notes.map((note) => (
        <p key={note} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{note}</p>
      ))}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
          No Paystack payments are waiting to be reflected.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {visible.map((row) => (
            <article key={`${row.kind}-${row.id}`} className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.storeName}</p>
                <p className="text-xs text-slate-500">
                  {KIND_LABEL[row.kind]} · GH₵ {row.amountGhs.toFixed(2)} · {row.detail}
                </p>
                <p className="truncate font-mono text-xs text-slate-700">{row.reference || 'No reference'}</p>
                <p className="text-[11px] text-slate-400">{row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busyId !== ''}
                  onClick={() => void cancel(row)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  {busyId === `${row.id}:cancel` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId !== ''}
                  onClick={() => void approve(row)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyId === `${row.id}:approve` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

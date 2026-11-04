import { useState } from 'react';
import { Loader2, ScrollText } from 'lucide-react';
import { ACTIVITY_TYPE_OPTIONS } from '@/lib/activityLog';
import { getAdminSessionToken } from '@/lib/adminAuth';

interface ActivityRow {
  id: string;
  store_name?: string;
  username?: string;
  role?: string;
  activity_type?: string;
  summary?: string;
  details?: string;
  logged_in_at?: string | null;
  logged_out_at?: string | null;
  created_at?: string;
}

function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function AdminActivityLog() {
  const [username, setUsername] = useState('');
  const [store, setStore] = useState('');
  const [query, setQuery] = useState('');
  const [activityType, setActivityType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin-activity-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          session: getAdminSessionToken(),
          username,
          store,
          query,
          activityType,
          from,
          to,
        }),
      });
      const data = await response.json() as { logs?: ActivityRow[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load the activity log.');
      setRows(Array.isArray(data.logs) ? data.logs : []);
      setLoaded(true);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load the activity log.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-slate-700" />
          <h2 className="text-base font-bold text-slate-900">System activity log</h2>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Sign-ins, sign-outs, and major actions. This log is available only in the administrator portal.
        </p>
        <form onSubmit={(event) => void load(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">
            User
            <input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Username" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Store
            <input value={store} onChange={(event) => setStore(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Store name" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Activity
            <select value={activityType} onChange={(event) => setActivityType(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              {ACTIVITY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Summary or note" />
          </label>
          <button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-3 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Loading…' : 'Show records'}
          </button>
        </form>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {!loaded ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Choose filters and show the log.</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No activity matches these filters.</p>
        ) : rows.map((row) => (
          <article key={row.id} className="border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.summary || row.activity_type}</p>
                <p className="text-[11px] text-slate-500">
                  {row.username || 'Unknown user'}
                  {row.role ? ` · ${row.role}` : ''}
                  {row.store_name ? ` · ${row.store_name}` : ''}
                  {row.activity_type ? ` · ${row.activity_type}` : ''}
                </p>
                {row.details && <p className="mt-1 text-xs text-slate-600">{row.details}</p>}
              </div>
              <div className="shrink-0 text-right text-[11px] text-slate-500">
                <p>{formatWhen(row.created_at)}</p>
                {row.activity_type === 'login' && (
                  <p>Out: {formatWhen(row.logged_out_at)}</p>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

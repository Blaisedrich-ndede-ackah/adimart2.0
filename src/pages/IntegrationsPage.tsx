import { useState } from 'react';
import { Activity, AlertCircle, Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

type ApiKeyRow = { id: string; name: string; scopes_json: string[]; last_used_at?: string | null; created_at: string; revoked_at?: string | null };
type WebhookRow = { id: string; url: string; events_json: string[]; is_active: boolean; created_at: string };
type DeliveryRow = { id: string; webhook_id: string; event: string; response_status?: number | null; last_error: string; attempts: number; delivered_at?: string | null; created_at: string };
const SCOPES = ['products:read', 'products:write', 'customers:read', 'customers:write', 'transactions:read', 'stores:read'];
const EVENTS = ['sale.created', 'stock.low', 'order.online', 'customer.created'];

export default function IntegrationsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const [pin, setPin] = useState('');
  const [keyName, setKeyName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['products:read', 'customers:read', 'transactions:read']);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['sale.created']);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  async function action(actionName: string, values: Record<string, unknown> = {}) {
    if (!currentStore?.id || !currentUser?.id) throw new Error('Select a store and sign in again.');
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your four-digit owner PIN to continue.');
    const response = await fetch('/api/integrations?action=manage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, store_id: currentStore.id, user_id: currentUser.id, owner_pin: pin, ...values }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Integration request failed.');
    return result;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the request.'); }
    finally { setBusy(false); }
  }
  const refresh = () => run(async () => {
    const result = await action('list'); setKeys(result.api_keys || []); setHooks(result.webhooks || []); setDeliveries(result.deliveries || []); setMessage('Integration settings refreshed.');
  });
  const createKey = () => run(async () => {
    const result = await action('create_key', { name: keyName, scopes });
    setOneTimeSecret(result.api_key); setKeyName(''); setMessage('Copy this API key now. It is only shown once.');
    const current = await action('list'); setKeys(current.api_keys || []); setHooks(current.webhooks || []); setDeliveries(current.deliveries || []);
  });
  const revokeKey = (id: string) => run(async () => {
    await action('revoke_key', { id }); const result = await action('list'); setKeys(result.api_keys || []); setHooks(result.webhooks || []); setDeliveries(result.deliveries || []); setMessage('API key revoked.');
  });
  const addWebhook = () => run(async () => {
    const result = await action('create_webhook', { url: webhookUrl, events });
    setOneTimeSecret(result.webhook_secret); setWebhookUrl(''); setMessage('Copy this signing secret now. It is only shown once.');
    const current = await action('list'); setKeys(current.api_keys || []); setHooks(current.webhooks || []); setDeliveries(current.deliveries || []);
  });
  const removeWebhook = (id: string) => run(async () => {
    await action('delete_webhook', { id }); const result = await action('list'); setKeys(result.api_keys || []); setHooks(result.webhooks || []); setDeliveries(result.deliveries || []); setMessage('Webhook removed.');
  });
  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-5xl space-y-4 p-4 pb-24 md:p-6">
    <header className="rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 p-5 text-white shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Phase 3 · Platform</p>
      <div className="mt-1 flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">API & webhooks</h1><p className="mt-1 text-sm text-white/70">Create store-scoped API keys and receive signed event callbacks.</p></div><button type="button" disabled={busy} onClick={refresh} className="rounded-full bg-white/15 p-2" aria-label="Refresh integrations"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button></div>
    </header>
    {(error || message) && <div role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}{error || message}</div>}
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <label className="block max-w-xs text-xs font-semibold text-gray-600">Owner PIN for integration changes<input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" placeholder="4-digit PIN" /></label>
      <p className="mt-2 text-xs text-gray-500">The server verifies the PIN before creating or revoking credentials. API keys are stored as hashes and shown once.</p>
    </section>
    {oneTimeSecret && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-950">Save this secret now</p><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-3 text-xs text-gray-900">{oneTimeSecret}</code><button type="button" onClick={() => { void navigator.clipboard?.writeText(oneTimeSecret); setCopied(true); }} className="rounded-lg bg-amber-900 px-3 text-white" aria-label="Copy secret"><Copy className="h-4 w-4" /></button></div><p className="mt-2 text-xs text-amber-900">{copied ? 'Copied.' : 'This value will disappear when you refresh the page.'}</p><button type="button" onClick={() => { setOneTimeSecret(''); setCopied(false); }} className="mt-2 text-xs font-semibold text-amber-950 underline">Hide secret</button></section>}
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-gray-900"><KeyRound className="h-4 w-4 text-indigo-700" />Create API key</h2><input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Key name, e.g. inventory sync" className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" /><div className="mt-3 grid grid-cols-2 gap-2">{SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 text-xs text-gray-700"><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scopes, scope, setScopes)} />{scope}</label>)}</div><button type="button" disabled={busy || !keyName.trim() || !scopes.length} onClick={createKey} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create key</button><div className="mt-4 space-y-2">{keys.map((key) => <article key={key.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-900">{key.name}{key.revoked_at ? ' · revoked' : ''}</p><p className="mt-1 text-[11px] text-gray-500">{(key.scopes_json || []).join(', ')} · {key.last_used_at ? `used ${new Date(key.last_used_at).toLocaleDateString()}` : 'never used'}</p></div>{!key.revoked_at && <button type="button" disabled={busy} onClick={() => revokeKey(key.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Revoke ${key.name}`}><Trash2 className="h-4 w-4" /></button>}</article>)}</div></section>
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-gray-900"><Webhook className="h-4 w-4 text-indigo-700" />Add webhook</h2><input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://your-service.example/webhook" className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" /><div className="mt-3 grid grid-cols-2 gap-2">{EVENTS.map((event) => <label key={event} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 text-xs text-gray-700"><input type="checkbox" checked={events.includes(event)} onChange={() => toggle(events, event, setEvents)} />{event}</label>)}</div><button type="button" disabled={busy || !webhookUrl.trim() || !events.length} onClick={addWebhook} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />Add webhook</button><div className="mt-4 space-y-2">{hooks.map((hook) => <article key={hook.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 p-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-900">{hook.url}</p><p className="mt-1 text-[11px] text-gray-500">{(hook.events_json || []).join(', ')}</p></div><button type="button" disabled={busy} onClick={() => removeWebhook(hook.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Remove webhook"><Trash2 className="h-4 w-4" /></button></article>)}</div></section>
    </div>
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><h2 className="font-bold text-gray-900">Recent webhook deliveries</h2><div className="mt-3 space-y-2">{deliveries.length ? deliveries.map((delivery) => <article key={delivery.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 p-3"><div><p className="text-xs font-semibold text-gray-900">{delivery.event} · {new Date(delivery.created_at).toLocaleString()}</p><p className="mt-1 text-[11px] text-gray-500">Attempt {delivery.attempts}{delivery.response_status ? ` · HTTP ${delivery.response_status}` : ''}</p>{delivery.last_error && <p className="mt-1 text-[11px] text-red-700">{delivery.last_error}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${delivery.delivered_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{delivery.delivered_at ? 'DELIVERED' : 'RETRY QUEUED'}</span></article>) : <p className="py-5 text-center text-sm text-gray-500">No webhook deliveries yet.</p>}</div></section>
    <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"><h2 className="flex items-center gap-2 font-bold"><Activity className="h-4 w-4" />API usage</h2><p className="mt-1 text-xs leading-relaxed">Send the key in <code>X-API-Key</code>. API requests are limited to 120 per minute per key. Resources are store-scoped; transaction and store records are read-only. See <a href="/public-api.md" className="font-semibold underline">API reference</a>.</p></section>
  </div></div>;
}

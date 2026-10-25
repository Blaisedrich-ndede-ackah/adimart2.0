import { useCallback, useEffect, useState } from 'react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  createLocalProspect,
  generateId,
  listLocalFollowUps,
  listLocalProspects,
  updateLocalProspect,
  type FollowUpChannel,
  type LocalFollowUp,
  type LocalProspect,
  type ProspectStatus,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { scheduleFollowUp, syncAgentPortal } from '@/lib/agentPortal';
import { SUBSCRIPTION_PACKAGES } from '@/lib/subscriptionPricing';
import { Button } from '@/components/ui/Button';

const STATUSES: ProspectStatus[] = ['lead', 'contacted', 'follow_up', 'converted', 'lost'];
const CHANNELS: FollowUpChannel[] = ['call', 'sms', 'whatsapp', 'visit', 'other'];

const EMPTY_FORM = {
  store_name: '',
  owner_full_name: '',
  owner_phone: '',
  owner_email: '',
  address: '',
  city: '',
  business_type: '',
  subscription_package: '1m',
  source: 'walk-in',
  notes: '',
};

interface AgentProspectsPageProps {
  onCreateInvoice?: () => void;
}

export default function AgentProspectsPage({ onCreateInvoice }: AgentProspectsPageProps) {
  const agent = useAgentAuthStore((state) => state.currentAgent);
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [filter, setFilter] = useState<'all' | ProspectStatus>('all');
  const [search, setSearch] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<LocalFollowUp[]>([]);
  const [followAt, setFollowAt] = useState('');
  const [channel, setChannel] = useState<FollowUpChannel>('call');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    setProspects(await listLocalProspects(agent.id));
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setFollowUps([]);
      return;
    }
    void listLocalFollowUps({ prospectId: selectedId }).then(setFollowUps);
  }, [selectedId, prospects]);

  const selected = prospects.find((row) => row.id === selectedId) || null;
  const filtered = prospects.filter((row) => {
    const matchesStatus = filter === 'all' || row.status === filter;
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      row.store_name.toLowerCase().includes(term) ||
      row.owner_full_name.toLowerCase().includes(term) ||
      row.owner_phone.includes(term);
    return matchesStatus && matchesSearch;
  });

  const saveProspect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!agent) return;
    if (!form.store_name.trim() || !form.owner_full_name.trim() || !form.owner_phone.trim()) {
      setError('Store name, owner name, and phone are required.');
      return;
    }
    if (!isValidGhanaPhone(form.owner_phone)) {
      setError('Enter a valid Ghana phone number.');
      return;
    }
    const now = new Date().toISOString();
    await createLocalProspect({
      id: generateId(),
      agent_id: agent.id,
      store_name: form.store_name.trim(),
      owner_full_name: form.owner_full_name.trim(),
      owner_phone: form.owner_phone.replace(/\D/g, ''),
      owner_email: form.owner_email.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      business_type: form.business_type.trim(),
      subscription_package: form.subscription_package,
      source: form.source,
      status: 'lead',
      notes: form.notes.trim(),
      last_contacted_at: null,
      next_follow_up_at: null,
      created_at: now,
      updated_at: now,
    });
    setForm(EMPTY_FORM);
    setOpenAdd(false);
    await syncAgentPortal();
    await load();
  };

  const changeStatus = async (status: ProspectStatus) => {
    if (!selected) return;
    await updateLocalProspect(selected.id, { status });
    await syncAgentPortal();
    await load();
  };

  const addFollowUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setError('');
    try {
      await scheduleFollowUp({ prospect: selected, followUpAt: followAt, channel });
      setFollowAt('');
      await syncAgentPortal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule the follow-up.');
    }
  };

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading prospects…</p>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Prospects</h2>
          <p className="text-sm text-gray-500">{filtered.length} store lead{filtered.length === 1 ? '' : 's'}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setOpenAdd((open) => !open)}>
          {openAdd ? 'Close' : 'Register store'}
        </Button>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>}

      {openAdd && (
        <form onSubmit={saveProspect} className="rounded-xl bg-white border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Store name" value={form.store_name} onChange={(value) => setForm({ ...form, store_name: value })} />
          <Field label="Owner name" value={form.owner_full_name} onChange={(value) => setForm({ ...form, owner_full_name: value })} />
          <Field label="Owner phone" value={form.owner_phone} onChange={(value) => setForm({ ...form, owner_phone: value.replace(/\D/g, '') })} />
          <Field label="Owner email" value={form.owner_email} onChange={(value) => setForm({ ...form, owner_email: value })} />
          <Field label="Address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
          <Field label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
          <Field label="Business type" value={form.business_type} onChange={(value) => setForm({ ...form, business_type: value })} />
          <label className="text-xs font-medium text-gray-500">
            Package
            <select
              value={form.subscription_package}
              onChange={(event) => setForm({ ...form, subscription_package: event.target.value })}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
            >
              {SUBSCRIPTION_PACKAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · GHS {item.baseGhs}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">
            Source
            <select
              value={form.source}
              onChange={(event) => setForm({ ...form, source: event.target.value })}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
            >
              <option value="walk-in">Walk-in</option>
              <option value="referral">Referral</option>
              <option value="social">Social media</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500 md:col-span-2">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={2}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" variant="primary">Save prospect</Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search store or owner"
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
        />
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as 'all' | ProspectStatus)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white border border-gray-100 divide-y divide-gray-50">
          {filtered.length === 0 && <p className="p-6 text-sm text-gray-500 text-center">No prospects match.</p>}
          {filtered.map((prospect) => (
            <button
              key={prospect.id}
              type="button"
              onClick={() => setSelectedId(prospect.id)}
              className={`w-full text-left px-4 py-3 ${selectedId === prospect.id ? 'bg-emerald-50' : ''}`}
            >
              <span className="block text-sm font-semibold text-gray-900">{prospect.store_name}</span>
              <span className="block text-xs text-gray-500">
                {prospect.owner_full_name} · {prospect.owner_phone} · {prospect.status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <section className="rounded-xl bg-white border border-gray-100 p-4 space-y-3">
            <h3 className="font-bold text-gray-900">{selected.store_name}</h3>
            <p className="text-sm text-gray-600">
              {selected.owner_full_name} · {selected.owner_phone}
              {selected.owner_email ? ` · ${selected.owner_email}` : ''}
            </p>
            <p className="text-sm text-gray-600">
              {[selected.address, selected.city].filter(Boolean).join(', ') || 'No address yet'} · {selected.business_type || 'Business type not set'}
            </p>
            <p className="text-sm text-gray-600">
              Package {selected.subscription_package || '—'} · Source {selected.source || '—'}
            </p>
            {selected.notes && <p className="text-sm text-gray-700">{selected.notes}</p>}
            <label className="block text-xs font-medium text-gray-500">
              Status
              <select
                value={selected.status}
                onChange={(event) => void changeStatus(event.target.value as ProspectStatus)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replace('_', ' ')}</option>
                ))}
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={() => onCreateInvoice?.()}>
              Create invoice
            </Button>

            <form onSubmit={addFollowUp} className="space-y-2 border-t border-gray-100 pt-3">
              <p className="text-sm font-semibold text-gray-900">Schedule follow-up</p>
              <input
                type="datetime-local"
                value={followAt}
                onChange={(event) => setFollowAt(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as FollowUpChannel)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {CHANNELS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="primary">Save follow-up</Button>
            </form>

            <div className="space-y-1">
              {followUps.length === 0 && <p className="text-xs text-gray-500">No follow-ups logged.</p>}
              {followUps.map((row) => (
                <p key={row.id} className="text-xs text-gray-600">
                  {new Date(row.follow_up_at).toLocaleString('en-GH')} · {row.channel} · {row.status}
                  {row.outcome ? ` · ${row.outcome}` : ''}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-gray-500">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
      />
    </label>
  );
}

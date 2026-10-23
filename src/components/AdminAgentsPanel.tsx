import { useCallback, useEffect, useState } from 'react';
import {
  listLocalAgentWithdrawalRequests,
  listLocalAgents,
  saveLocalCommissionSettings,
  updateLocalAgent,
  type LocalAgent,
  type LocalAgentCommissionSetting,
  type LocalAgentWithdrawalRequest,
} from '@/lib/dexie';
import {
  ensureCommissionSettings,
  registerAgent,
  setWithdrawalStatus,
  syncAgentPortal,
} from '@/lib/agentPortal';
import { formatOfficialMoney } from '@/lib/currency';

const NETWORKS = ['', 'MTN', 'Telecel', 'AirtelTigo'];

export default function AdminAgentsPanel() {
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [withdrawals, setWithdrawals] = useState<LocalAgentWithdrawalRequest[]>([]);
  const [settings, setSettings] = useState<LocalAgentCommissionSetting | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    pin: '',
    commissionPercentage: '10',
    momoNumber: '',
    momoNetwork: 'MTN',
    momoAccountName: '',
  });
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [payoutRef, setPayoutRef] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const sync = await syncAgentPortal();
    setNotice(sync.message);
    const [agentRows, requests, currentSettings] = await Promise.all([
      listLocalAgents(),
      listLocalAgentWithdrawalRequests(),
      ensureCommissionSettings(),
    ]);
    setAgents(agentRows.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setWithdrawals(requests.sort((a, b) => b.requested_at.localeCompare(a.requested_at)));
    setSettings(currentSettings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await registerAgent({
        fullName: form.fullName,
        phone: form.phone,
        email: form.email,
        pin: form.pin,
        commissionPercentage: Number(form.commissionPercentage),
        momoNumber: form.momoNumber,
        momoNetwork: form.momoNetwork,
        momoAccountName: form.momoAccountName,
      });
      await syncAgentPortal();
      setNotice(`Agent ${created.full_name} created. They sign in with ${created.phone} and the PIN you set.`);
      setForm({
        fullName: '',
        phone: '',
        email: '',
        pin: '',
        commissionPercentage: String(settings?.default_commission_percentage ?? 10),
        momoNumber: '',
        momoNetwork: 'MTN',
        momoAccountName: '',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the agent.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (agent: LocalAgent, status: LocalAgent['status']) => {
    await updateLocalAgent(agent.id, { status });
    await syncAgentPortal();
    await load();
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    await saveLocalCommissionSettings({ ...settings, updated_at: new Date().toISOString() });
    const result = await syncAgentPortal();
    setNotice(result.message);
  };

  const act = async (
    id: string,
    status: 'approved' | 'rejected' | 'paid'
  ) => {
    setError('');
    try {
      await setWithdrawalStatus(id, status, {
        reason: rejectReason[id],
        payoutReference: payoutRef[id],
      });
      await syncAgentPortal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the withdrawal.');
    }
  };

  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.full_name || 'Agent';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Agents</h2>
        <p className="text-sm text-slate-600">
          Register field agents, set commission, and approve Mobile Money withdrawals. Run{' '}
          <code>supabase-migrate-agent-portal.sql</code> once so agents on other phones can sign in.
        </p>
      </div>
      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl p-3">{notice}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>}

      <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <h3 className="md:col-span-2 font-semibold text-slate-900">New agent</h3>
        <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Full name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone 024XXXXXXX" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <input required inputMode="numeric" maxLength={4} value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, '') })} placeholder="4-digit PIN" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <input required type="number" min="0" max="100" step="0.01" value={form.commissionPercentage} onChange={(event) => setForm({ ...form, commissionPercentage: event.target.value })} placeholder="Commission %" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <input value={form.momoNumber} onChange={(event) => setForm({ ...form, momoNumber: event.target.value })} placeholder="MoMo number" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <select value={form.momoNetwork} onChange={(event) => setForm({ ...form, momoNetwork: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          {NETWORKS.map((network) => (
            <option key={network || 'none'} value={network}>{network || 'No network yet'}</option>
          ))}
        </select>
        <input value={form.momoAccountName} onChange={(event) => setForm({ ...form, momoAccountName: event.target.value })} placeholder="MoMo account name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        <button type="submit" disabled={busy} className="md:col-span-2 rounded-xl bg-primary text-white py-2.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Create agent'}
        </button>
      </form>

      {settings && (
        <form onSubmit={saveSettings} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <h3 className="md:col-span-3 font-semibold text-slate-900">Withdrawal rules</h3>
          <label className="text-xs text-slate-500">
            Default commission %
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={settings.default_commission_percentage}
              onChange={(event) => setSettings({ ...settings, default_commission_percentage: Number(event.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Minimum withdrawal (GHS)
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.min_withdrawal_ghs}
              onChange={(event) => setSettings({ ...settings, min_withdrawal_ghs: Number(event.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Flat fee (GHS)
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.withdrawal_fee_ghs}
              onChange={(event) => setSettings({ ...settings, withdrawal_fee_ghs: Number(event.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="md:col-span-3 rounded-xl border border-slate-200 py-2 text-sm font-semibold">
            Save rules
          </button>
        </form>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <h3 className="px-4 py-3 font-semibold text-slate-900 border-b border-slate-100">Registered agents</h3>
        {agents.length === 0 && <p className="p-4 text-sm text-slate-500">No agents yet.</p>}
        <ul className="divide-y divide-slate-100">
          {agents.map((agent) => (
            <li key={agent.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{agent.full_name}</p>
                <p className="text-xs text-slate-500">
                  {agent.phone} · {agent.commission_percentage}% · {agent.momo_network || 'No MoMo'} {agent.momo_number}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-semibold text-slate-500">{agent.status}</span>
                {agent.status !== 'active' && (
                  <button type="button" className="text-xs font-semibold text-emerald-700" onClick={() => void setStatus(agent, 'active')}>Activate</button>
                )}
                {agent.status === 'active' && (
                  <button type="button" className="text-xs font-semibold text-amber-700" onClick={() => void setStatus(agent, 'suspended')}>Suspend</button>
                )}
                {agent.status !== 'inactive' && (
                  <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => void setStatus(agent, 'inactive')}>Deactivate</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <h3 className="px-4 py-3 font-semibold text-slate-900 border-b border-slate-100">Withdrawals</h3>
        {withdrawals.length === 0 && <p className="p-4 text-sm text-slate-500">No withdrawal requests.</p>}
        <ul className="divide-y divide-slate-100">
          {withdrawals.map((row) => (
            <li key={row.id} className="px-4 py-3 space-y-2">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {agentName(row.agent_id)} · {formatOfficialMoney(row.amount_ghs, 'GHS')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.momo_account_name} · {row.momo_number} · {row.momo_network} · net {formatOfficialMoney(row.net_amount_ghs, 'GHS')}
                  </p>
                </div>
                <span className="text-xs uppercase font-semibold text-slate-500">{row.status}</span>
              </div>
              {row.status === 'pending' || row.status === 'approved' ? (
                <div className="flex flex-wrap gap-2">
                  {row.status === 'pending' && (
                    <button type="button" className="rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5" onClick={() => void act(row.id, 'approved')}>
                      Approve
                    </button>
                  )}
                  <input
                    value={payoutRef[row.id] || ''}
                    onChange={(event) => setPayoutRef((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="Payout reference"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  />
                  <button type="button" className="rounded-lg bg-slate-900 text-white text-xs font-semibold px-3 py-1.5" onClick={() => void act(row.id, 'paid')}>
                    Mark paid
                  </button>
                  <input
                    value={rejectReason[row.id] || ''}
                    onChange={(event) => setRejectReason((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="Rejection reason"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  />
                  <button type="button" className="rounded-lg border border-red-200 text-red-700 text-xs font-semibold px-3 py-1.5" onClick={() => void act(row.id, 'rejected')}>
                    Reject
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {row.payout_reference ? `Ref ${row.payout_reference}` : row.rejection_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

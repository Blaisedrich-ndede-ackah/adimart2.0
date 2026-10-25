import { useCallback, useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  createLocalAgentWithdrawalRequest,
  generateId,
  listLocalAgentWithdrawalRequests,
  updateLocalAgent,
  type LocalAgentWithdrawalRequest,
} from '@/lib/dexie';
import {
  getAgentBalance,
  isAgentBiometricReady,
  registerAgentBiometric,
  syncAgentPortal,
  type AgentBalance,
} from '@/lib/agentPortal';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { formatOfficialMoney } from '@/lib/currency';
import { Button } from '@/components/ui/Button';

const NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'];

export default function AgentWalletPage() {
  const agent = useAgentAuthStore((state) => state.currentAgent);
  const refreshAgent = useAgentAuthStore((state) => state.refreshAgent);
  const [balance, setBalance] = useState<AgentBalance | null>(null);
  const [withdrawals, setWithdrawals] = useState<LocalAgentWithdrawalRequest[]>([]);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [momoNumber, setMomoNumber] = useState(agent?.momo_number || '');
  const [momoNetwork, setMomoNetwork] = useState(agent?.momo_network || 'MTN');
  const [momoName, setMomoName] = useState(agent?.momo_account_name || '');
  const [biometricOn, setBiometricOn] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    const [nextBalance, rows, bio] = await Promise.all([
      getAgentBalance(agent.id),
      listLocalAgentWithdrawalRequests(agent.id),
      isAgentBiometricReady(),
    ]);
    setBalance(nextBalance);
    setWithdrawals(rows.sort((a, b) => b.requested_at.localeCompare(a.requested_at)));
    setBiometricOn(bio);
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMomo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agent) return;
    setError('');
    if (!isValidGhanaPhone(momoNumber) || !momoNetwork || !momoName.trim()) {
      setError('Enter a Ghana MoMo number, network, and account name.');
      return;
    }
    await updateLocalAgent(agent.id, {
      momo_number: momoNumber.replace(/\D/g, ''),
      momo_network: momoNetwork,
      momo_account_name: momoName.trim(),
    });
    await refreshAgent();
    await syncAgentPortal();
  };

  const requestWithdrawal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agent || !balance) return;
    setError('');
    const value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a withdrawal amount.');
      return;
    }
    if (value < balance.minWithdrawal) {
      setError(`Minimum withdrawal is ${formatOfficialMoney(balance.minWithdrawal, 'GHS')}.`);
      return;
    }
    if (value > balance.payable) {
      setError(`Amount is above your payable balance of ${formatOfficialMoney(balance.payable, 'GHS')}.`);
      return;
    }
    if (!agent.momo_number || !agent.momo_network || !agent.momo_account_name) {
      setError('Save a Mobile Money payout number before requesting a withdrawal.');
      return;
    }
    const fee = Math.round(balance.withdrawalFee * 100) / 100;
    if (value <= fee) {
      setError('Amount must be greater than the withdrawal fee.');
      return;
    }
    const now = new Date().toISOString();
    await createLocalAgentWithdrawalRequest({
      id: generateId(),
      agent_id: agent.id,
      amount_ghs: value,
      fee_ghs: fee,
      net_amount_ghs: Math.round((value - fee) * 100) / 100,
      momo_number: agent.momo_number,
      momo_network: agent.momo_network,
      momo_account_name: agent.momo_account_name,
      status: 'pending',
      rejection_reason: '',
      payout_reference: '',
      requested_at: now,
      processed_at: null,
      processed_by: null,
      created_at: now,
      updated_at: now,
    });
    setAmount('');
    await syncAgentPortal();
    await load();
  };

  const enableBiometric = async () => {
    if (!agent) return;
    setError('');
    try {
      await registerAgentBiometric(agent.id, agent.full_name);
      setBiometricOn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Biometric setup failed.');
    }
  };

  if (loading || !balance) return <p className="p-6 text-sm text-gray-500">Loading wallet…</p>;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Wallet</h2>
        <p className="text-sm text-gray-500">Commission balance and Mobile Money withdrawals.</p>
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Earned" value={formatOfficialMoney(balance.earned, 'GHS')} />
        <Metric label="Reserved" value={formatOfficialMoney(balance.reserved, 'GHS')} />
        <Metric label="Paid out" value={formatOfficialMoney(balance.paidOut, 'GHS')} />
        <Metric label="Payable" value={formatOfficialMoney(balance.payable, 'GHS')} />
      </div>

      <form onSubmit={saveMomo} className="rounded-xl bg-white border border-gray-100 p-4 grid gap-3">
        <p className="text-sm font-semibold text-gray-900">Payout Mobile Money</p>
        <input
          value={momoNumber}
          onChange={(event) => setMomoNumber(event.target.value.replace(/\D/g, ''))}
          placeholder="024XXXXXXX"
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          aria-label="MoMo number"
        />
        <select
          value={momoNetwork}
          onChange={(event) => setMomoNetwork(event.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          aria-label="MoMo network"
        >
          {NETWORKS.map((network) => (
            <option key={network} value={network}>{network}</option>
          ))}
        </select>
        <input
          value={momoName}
          onChange={(event) => setMomoName(event.target.value)}
          placeholder="Account name"
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          aria-label="MoMo account name"
        />
        <Button type="submit" variant="outline" size="sm">Save payout number</Button>
      </form>

      <form onSubmit={requestWithdrawal} className="rounded-xl bg-white border border-gray-100 p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Request withdrawal</p>
        <p className="text-xs text-gray-500">
          Payable {formatOfficialMoney(balance.payable, 'GHS')} · minimum {formatOfficialMoney(balance.minWithdrawal, 'GHS')} · fee {formatOfficialMoney(balance.withdrawalFee, 'GHS')} flat
        </p>
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount in GHS"
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
        />
        <Button type="submit" variant="primary" size="sm">Submit request</Button>
      </form>

      <div className="rounded-xl bg-white border border-gray-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Biometric unlock</p>
            <p className="text-xs text-gray-500">Use this device’s biometrics after your first PIN sign-in.</p>
          </div>
          <Button
            size="sm"
            variant={biometricOn ? 'outline' : 'primary'}
            leftIcon={<Fingerprint className="w-4 h-4" />}
            onClick={() => void enableBiometric()}
          >
            {biometricOn ? 'Update' : 'Enable'}
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-gray-900">Withdrawal history</h3>
        {withdrawals.length === 0 && <p className="text-sm text-gray-500">No requests yet.</p>}
        {withdrawals.map((row) => (
          <article key={row.id} className="rounded-xl bg-white border border-gray-100 p-3 text-sm">
            <div className="flex justify-between">
              <span className="font-semibold">{formatOfficialMoney(row.amount_ghs, 'GHS')}</span>
              <span className="uppercase text-xs text-emerald-700">{row.status}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {row.momo_number} · {row.momo_network} · fee {formatOfficialMoney(row.fee_ghs, 'GHS')} · net {formatOfficialMoney(row.net_amount_ghs, 'GHS')}
            </p>
            {row.payout_reference && <p className="text-xs text-gray-500">Payout ref {row.payout_reference}</p>}
            {row.rejection_reason && <p className="text-xs text-red-700">{row.rejection_reason}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-gray-100 p-4">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}

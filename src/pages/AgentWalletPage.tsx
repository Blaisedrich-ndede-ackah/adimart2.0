import { useCallback, useEffect, useState } from 'react';
import {
  Wallet, Plus, Send, RefreshCcw, Clock, ChevronRight,
  AlertCircle, CheckCircle2, Search, Filter,
} from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  listLocalAgentCommissions,
  listLocalAgentWithdrawalRequests,
  createLocalAgentWithdrawalRequest,
  updateLocalAgentWithdrawalRequest,
  getLocalCommissionSettings,
  saveLocalCommissionSettings,
  type LocalAgentCommission,
  type LocalAgentWithdrawalRequest,
} from '@/lib/dexie';
import { formatOfficialMoney } from '@/lib/currency';
import { LinkButton } from '@/components/ui/button';

type WithdrawalStatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'paid';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  paid: 'bg-indigo-50 text-indigo-700 border-indigo-100',
};

export default function AgentWalletPage() {
  const { currentAgent } = useAgentAuthStore();
  const [commissions, setCommissions] = useState<LocalAgentCommission[]>([]);
  const [withdrawals, setWithdrawals] = useState<LocalAgentWithdrawalRequest[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [openRequest, setOpenRequest] = useState(false);
  const [form, setForm] = useState({
    amount_ghs: '',
  });
  const [requestError, setRequestError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [commData, wdData, settingsData] = await Promise.all([
        listLocalAgentCommissions(currentAgent?.id),
        listLocalAgentWithdrawalRequests(currentAgent?.id),
        getLocalCommissionSettings(),
      ]);
      setCommissions(commData);
      setWithdrawals(wdData);
      setSettings(settingsData);
    } finally {
      setLoading(false);
    }
  }, [currentAgent?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  });

  const accrued = commissions.filter(c => c.status === 'accrued').reduce((s, c) => s + c.commission_amount_ghs, 0);
  const paidOut = commissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.commission_amount_ghs, 0);
  const payable = accrued - paidOut;

  const minWithdrawal = settings?.min_withdrawal_ghs ?? 0;
  const withdrawalFee = settings?.withdrawal_fee_ghs ?? 0;

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError('');
    const amount = Number(form.amount_ghs);
    if (!Number.isFinite(amount) || amount <= 0) {
      setRequestError('Enter a valid amount.');
      return;
    }
    if (amount < minWithdrawal) {
      setRequestError(`Minimum withdrawal amount is ${formatOfficialMoney(minWithdrawal, 'GHS')}.`);
      return;
    }
    if (amount > payable) {
      setRequestError(`Amount exceeds your payable balance of ${formatOfficialMoney(payable, 'GHS')}.`);
      return;
    }
    if (!currentAgent?.momo_number) {
      setRequestError('No Mobile Money number registered. Please update your profile first.');
      return;
    }
    try {
      const fee = amount * (withdrawalFee / 100);
      const netAmount = amount - fee;
      await createLocalAgentWithdrawalRequest({
        id: 'wd_' + Math.random().toString(36).substring(2, 15),
        agent_id: currentAgent.id,
        amount_ghs: amount,
        fee_ghs: fee,
        net_amount_ghs: netAmount,
        momo_number: currentAgent.momo_number,
        momo_network: currentAgent.momo_network,
        momo_account_name: currentAgent.momo_account_name,
        status: 'pending',
        rejection_reason: '',
        payout_reference: '',
        requested_at: new Date().toISOString(),
        processed_at: null,
        processed_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as LocalAgentWithdrawalRequest);
      setOpenRequest(false);
      setForm({ amount_ghs: '' });
      void load();
    } catch (err: any) {
      setRequestError(err instanceof Error ? err.message : 'Failed to request withdrawal.');
    }
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[400px]">
        <RefreshCcw className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="page-shell p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Wallet</h1>
          <p className="text-sm text-gray-500">Commission balance and MoMo withdrawals.</p>
        </div>
        <LinkButton
          onClick={() => setOpenRequest(true)}
          variant="primary"
          size="sm"
          icon={<Send className="w-4 h-4" />}
        >
          Request Withdrawal
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Accrued Commission</p>
              <p className="text-2xl font-bold text-gray-900">{formatOfficialMoney(accrued, 'GHS')}</p>
            </div>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Paid Out</p>
              <p className="text-2xl font-bold text-gray-900">{formatOfficialMoney(paidOut, 'GHS')}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Payable Balance</p>
              <p className="text-2xl font-bold text-gray-900">{formatOfficialMoney(payable, 'GHS')}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Send className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Min. Withdrawal</p>
              <p className="text-2xl font-bold text-gray-900">{formatOfficialMoney(minWithdrawal, 'GHS')}</p>
            </div>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
      {/* Request withdrawal form */}
      {openRequest && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-lg p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Request Withdrawal</h2>
          <p className="text-sm text-gray-500 mb-4">
            Payout will be sent to your registered MoMo number: <span className="font-medium">{currentAgent?.momo_number}</span> ({currentAgent?.momo_network})
          </p>
          <form onSubmit={handleRequest} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Amount (GHS)</label>
              <input
                type="number"
                step="0.01"
                value={form.amount_ghs}
                onChange={(e) => setForm({ ...form, amount_ghs: e.target.value })}
                placeholder={`Max ${formatOfficialMoney(payable, 'GHS')}`}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-gray-400">
                Payable balance: {formatOfficialMoney(payable, 'GHS')} • Min: {formatOfficialMoney(minWithdrawal, 'GHS')} • Fee: {withdrawalFee}%
              </p>
            </div>
            {requestError && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                <p className="text-sm text-red-700">{requestError}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpenRequest(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 shadow-sm shadow-emerald-100">
                Request Withdrawal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Withdrawal history */}
      <div className="rounded-xl bg-white border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Withdrawal History</h2>
          <LinkButton variant="outline" size="sm" icon={<RefreshCcw className="w-3 h-3" />}>
            Refresh
          </LinkButton>
        </div>
        {withdrawals.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Wallet className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No withdrawal requests yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {withdrawals.map((wd) => (
              <div key={wd.id} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-gray-900">{formatOfficialMoney(wd.amount_ghs, 'GHS')}</div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[wd.status]}`}>
                    {STATUS_LABELS[wd.status]}
                  </span>
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>
                    <span className="font-medium">To: </span>{wd.momo_number} ({wd.momo_network})
                  </div>
                  <div>
                    <span className="font-medium">Account: </span>{wd.momo_account_name}
                  </div>
                  <div>
                    <span className="font-medium">Fee: </span>{formatOfficialMoney(wd.fee_ghs, 'GHS')} •
                    <span className="font-medium">Net: </span>{formatOfficialMoney(wd.net_amount_ghs, 'GHS')}
                  </div>
                  <div>
                    <span className="font-medium">Requested: </span>{new Date(wd.requested_at).toLocaleDateString()}
                  </div>
                  {wd.payout_reference && (
                    <div>
                      <span className="font-medium">Payout Ref: </span>{wd.payout_reference}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

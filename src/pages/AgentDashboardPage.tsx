import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Users, FileText, Wallet, Clock, Send, RefreshCcw,
  AlertCircle, CheckCircle2, ChevronRight, ArrowRight,
} from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  listLocalProspects,
  listLocalFollowUps,
  listLocalAgentInvoices,
  listLocalAgentCommissions,
  listLocalAgentWithdrawalRequests,
  getLocalCommissionSettings,
  type LocalProspect,
  type LocalFollowUp,
  type LocalAgentInvoice,
  type LocalAgentCommission,
} from '@/lib/dexie';
import { useFormatMoney } from '@/lib/currency';
import { formatOfficialDate } from '@/lib/formalPdf';
import { LinkButton } from '@/components/ui/button';

export default function AgentDashboardPage() {
  const { currentAgent, refreshAgent, listAgents } = useAgentAuthStore();
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [followUps, setFollowUps] = useState<LocalFollowUp[]>([]);
  const [invoices, setInvoices] = useState<LocalAgentInvoice[]>([]);
  const [commissions, setCommissions] = useState<LocalAgentCommission[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const formatMoney = useFormatMoney();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prospectsData, followUpsData, invoicesData, commissionsData, settingsData] =
        await Promise.all([
          listLocalProspects(currentAgent?.id),
          listLocalFollowUps({ agentId: currentAgent?.id, status: 'scheduled' }),
          listLocalAgentInvoices(currentAgent?.id),
          listLocalAgentCommissions(currentAgent?.id),
          getLocalCommissionSettings(),
        ]);
      setProspects(prospectsData);
      setFollowUps(followUpsData);
      setInvoices(invoicesData);
      setCommissions(commissionsData);
      setSettings(settingsData);
      setWithdrawals([]);
    } finally {
      setLoading(false);
    }
  }, [currentAgent?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const accrued = useMemo(() => commissions.filter(c => c.status === 'accrued').reduce((s, c) => s + c.commission_amount_ghs, 0), [commissions]);
  const paid = useMemo(() => commissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.commission_amount_ghs, 0), [commissions]);
  const payable = accrued - paid;

  const statusLabels: Record<string, string> = {
    lead: 'Lead',
    contacted: 'Contacted',
    follow_up: 'Follow Up',
    converted: 'Converted',
    lost: 'Lost',
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[400px]">
        <RefreshCcw className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  return (
    <div className="page-shell p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agent Dashboard</h1>
          <p className="text-sm text-gray-500">
            Welcome back, {currentAgent?.full_name} ({currentAgent?.phone})
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton onClick={() => void loadData()} variant="outline" size="sm" icon={<RefreshCcw className="w-4 h-4" />}>
            Refresh
          </LinkButton>
          <LinkButton
            onClick={() => {}}
            variant="default"
            icon={<Plus className="w-4 h-4" />}
          >
            Register Store
          </LinkButton>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Total Prospects</p>
              <p className="text-2xl font-bold text-gray-900">{prospects.length}</p>
            </div>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Pending Follow-ups</p>
              <p className="text-2xl font-bold text-gray-900">{followUps.length}</p>
            </div>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Invoices Issued</p>
              <p className="text-2xl font-bold text-gray-900">{invoices.length}</p>
            </div>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <FileText className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Payable Balance</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(payable)}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Send className="w-4 h-4 text-gray-500" /> Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <LinkButton variant="default" onClick={() => {}} icon={<Plus className="w-4 h-4" />}>
            Register Store
          </LinkButton>
          <LinkButton variant="default" onClick={() => {}} icon={<FileText className="w-4 h-4" />}>
            Create Invoice
          </LinkButton>
          <LinkButton variant="outline" onClick={() => {}} icon={<Wallet className="w-4 h-4" />}>
            Request Withdrawal
          </LinkButton>
          <LinkButton variant="outline" onClick={() => {}} icon={<Clock className="w-4 h-4" />}>
            Follow-ups
          </LinkButton>
        </div>
      </div>

      {/* Recent prospects */}
      <div className="rounded-xl bg-white border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Recent Prospects</h2>
          <LinkButton variant="outline" size="sm" icon={<ChevronRight className="w-3 h-3" />}>
            View all
          </LinkButton>
        </div>
        {prospects.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No prospects yet. Register your first store.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {prospects.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.store_name}</p>
                  <p className="text-xs text-gray-500 truncate">{p.owner_full_name} • {p.owner_phone}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  p.status === 'lead' ? 'bg-blue-50 text-blue-700' :
                  p.status === 'contacted' ? 'bg-indigo-50 text-indigo-700' :
                  p.status === 'follow_up' ? 'bg-amber-50 text-amber-700' :
                  p.status === 'converted' ? 'bg-emerald-50 text-emerald-700' :
                  'bg-gray-50 text-gray-700'
                }`}>
                  {statusLabels[p.status]}
                </span>
                <ArrowRight className="w-3 h-3 text-gray-300" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Follow-ups due alert */}
      <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="text-sm font-bold text-amber-800">Follow-ups Due</h3>
            <p className="text-xs text-amber-700 mt-1">
              {followUps.length} follow-up(s) scheduled. Stay on top of your leads.
            </p>
          </div>
          <LinkButton variant="default" size="sm" className="ml-auto">
            View Follow-ups
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
      </div>
  }
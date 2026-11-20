import { useCallback, useEffect, useState } from 'react';
import { Clock, FileText, Plus, RefreshCcw, Users, Wallet } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  listLocalAgentInvoices,
  listLocalFollowUps,
  listLocalProspects,
  type LocalFollowUp,
  type LocalProspect,
} from '@/lib/dexie';
import { getAgentBalance, refreshOverdueInvoices, syncAgentPortal } from '@/lib/agentPortal';
import { formatOfficialMoney } from '@/lib/currency';
import { Button } from '@/components/ui/Button';
import type { AgentScreen } from '@/components/AgentShell';

interface AgentDashboardPageProps {
  onNavigate: (screen: AgentScreen) => void;
}

export default function AgentDashboardPage({ onNavigate }: AgentDashboardPageProps) {
  const agent = useAgentAuthStore((state) => state.currentAgent);
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [followUps, setFollowUps] = useState<LocalFollowUp[]>([]);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [payable, setPayable] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    await refreshOverdueInvoices(agent.id);
    const [prospectRows, followRows, invoices, balance] = await Promise.all([
      listLocalProspects(agent.id),
      listLocalFollowUps({ agentId: agent.id, status: 'scheduled' }),
      listLocalAgentInvoices(agent.id),
      getAgentBalance(agent.id),
    ]);
    setProspects(prospectRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setFollowUps(followRows);
    setInvoiceCount(invoices.length);
    setPayable(balance.payable);
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdue = followUps.filter((row) => new Date(row.follow_up_at).getTime() < Date.now()).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <RefreshCcw className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-500">
            {agent?.full_name} · {agent?.phone} · {agent?.commission_percentage}% commission
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCcw className="w-4 h-4" />}
          onClick={() => void syncAgentPortal().then(() => load())}
        >
          Sync
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Prospects" value={String(prospects.length)} icon={<Users className="w-4 h-4" />} />
        <Stat label="Follow-ups due" value={String(followUps.length)} icon={<Clock className="w-4 h-4" />} />
        <Stat label="Invoices" value={String(invoiceCount)} icon={<FileText className="w-4 h-4" />} />
        <Stat label="Payable" value={formatOfficialMoney(payable, 'GHS')} icon={<Wallet className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onNavigate('prospects')}>
          Register store
        </Button>
        <Button variant="primary" leftIcon={<FileText className="w-4 h-4" />} onClick={() => onNavigate('invoices')}>
          Create invoice
        </Button>
        <Button variant="outline" leftIcon={<Wallet className="w-4 h-4" />} onClick={() => onNavigate('wallet')}>
          Withdraw
        </Button>
        <Button variant="outline" leftIcon={<Clock className="w-4 h-4" />} onClick={() => onNavigate('followups')}>
          Follow-ups
        </Button>
      </div>

      {overdue > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('followups')}
          className="w-full text-left rounded-xl bg-amber-50 border border-amber-100 p-4"
        >
          <p className="text-sm font-bold text-amber-900">{overdue} overdue follow-up{overdue === 1 ? '' : 's'}</p>
          <p className="text-xs text-amber-800 mt-1">Open follow-ups to log the call, visit, or WhatsApp.</p>
        </button>
      )}

      <section className="rounded-xl bg-white border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900">Recent prospects</h3>
          <button type="button" className="text-xs font-semibold text-emerald-700" onClick={() => onNavigate('prospects')}>
            View all
          </button>
        </div>
        {prospects.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No prospects yet. Register the first store.</p>
        ) : (
          <div className="space-y-2">
            {prospects.slice(0, 5).map((prospect) => (
              <button
                key={prospect.id}
                type="button"
                onClick={() => onNavigate('prospects')}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">{prospect.store_name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {prospect.owner_full_name} · {prospect.owner_phone}
                  </span>
                </span>
                <span className="text-xs font-semibold uppercase text-emerald-700">{prospect.status.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white border border-gray-100 p-4">
      <div className="flex items-center justify-between text-gray-400">{icon}</div>
      <p className="mt-2 text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}

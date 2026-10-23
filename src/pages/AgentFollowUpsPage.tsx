import { useCallback, useEffect, useState } from 'react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  listLocalFollowUps,
  listLocalProspects,
  type FollowUpChannel,
  type LocalFollowUp,
  type LocalProspect,
} from '@/lib/dexie';
import { completeFollowUp, syncAgentPortal } from '@/lib/agentPortal';
import { Button } from '@/components/ui/Button';

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AgentFollowUpsPage() {
  const agent = useAgentAuthStore((state) => state.currentAgent);
  const [rows, setRows] = useState<LocalFollowUp[]>([]);
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    const [followUps, prospectRows] = await Promise.all([
      listLocalFollowUps({ agentId: agent.id }),
      listLocalProspects(agent.id),
    ]);
    setRows(followUps);
    setProspects(prospectRows);
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  const prospectName = (id: string) => prospects.find((row) => row.id === id)?.store_name || 'Prospect';

  const finish = async (row: LocalFollowUp, status: 'completed' | 'missed') => {
    setError('');
    try {
      await completeFollowUp(row, outcomes[row.id] || '', status);
      await syncAgentPortal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the follow-up.');
    }
  };

  const scheduled = rows.filter((row) => row.status === 'scheduled');
  const history = rows.filter((row) => row.status !== 'scheduled').reverse();

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading follow-ups…</p>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Follow-ups</h2>
        <p className="text-sm text-gray-500">Calls, visits, SMS, and WhatsApp scheduled for your prospects.</p>
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>}

      {scheduled.length === 0 ? (
        <p className="rounded-xl bg-white border border-gray-100 p-6 text-sm text-gray-500 text-center">
          No follow-ups scheduled. Open a prospect and add the next contact.
        </p>
      ) : (
        <div className="space-y-3">
          {scheduled.map((row) => {
            const overdue = new Date(row.follow_up_at).getTime() < Date.now();
            return (
              <article key={row.id} className="rounded-xl bg-white border border-gray-100 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{prospectName(row.prospect_id)}</p>
                    <p className="text-xs text-gray-500">
                      {whenLabel(row.follow_up_at)} · {(row.channel as FollowUpChannel) || 'call'}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${overdue ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {overdue ? 'Overdue' : 'Scheduled'}
                  </span>
                </div>
                <textarea
                  value={outcomes[row.id] || ''}
                  onChange={(event) => setOutcomes((current) => ({ ...current, [row.id]: event.target.value }))}
                  placeholder="What happened?"
                  rows={2}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void finish(row, 'completed')}>
                    Completed
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void finish(row, 'missed')}>
                    Missed
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-gray-900">History</h3>
          {history.slice(0, 12).map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
              <p className="font-medium text-gray-900">
                {prospectName(row.prospect_id)} · {row.status}
              </p>
              <p className="text-xs text-gray-500">
                {whenLabel(row.follow_up_at)} · {row.channel}
                {row.outcome ? ` · ${row.outcome}` : ''}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

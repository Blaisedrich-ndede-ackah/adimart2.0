import { useMemo, useState } from 'react';
import { Plus, ReceiptText, PauseCircle, PlayCircle, XCircle, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { formatPesewas, ghsToPesewas } from '@/lib/payroll/calculator';
import {
  currentPayMonth,
  savePayrollDeduction,
  updateDeductionStatus,
  type PayrollActor,
} from '@/lib/payroll/store';
import type {
  LocalPayrollDeduction,
  LocalPayrollDeductionRepayment,
  LocalPayrollStaff,
  PayrollDeductionKind,
} from '@/lib/payroll/types';

interface DeductionsManagerProps {
  storeId: string;
  staffList: LocalPayrollStaff[];
  deductions: LocalPayrollDeduction[];
  repayments: LocalPayrollDeductionRepayment[];
  actor: PayrollActor;
  onRefresh: () => Promise<void>;
}

const KIND_LABELS: Record<PayrollDeductionKind, string> = {
  loan: 'Staff Loan',
  advance: 'Salary Advance',
  fine: 'Fine / Shortage',
};

export default function DeductionsManager({
  storeId,
  staffList,
  deductions,
  repayments,
  actor,
  onRefresh,
}: DeductionsManagerProps) {
  const [filterKind, setFilterKind] = useState<'all' | PayrollDeductionKind>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [kind, setKind] = useState<PayrollDeductionKind>('advance');
  const [reason, setReason] = useState('');
  const [totalGhs, setTotalGhs] = useState('');
  const [monthlyGhs, setMonthlyGhs] = useState('');
  const [startMonth, setStartMonth] = useState(() => currentPayMonth());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const staffMap = useMemo(() => new Map(staffList.map((s) => [s.id, s])), [staffList]);
  const activeStaff = useMemo(() => staffList.filter((s) => s.is_active === 1), [staffList]);

  const filtered = useMemo(
    () => deductions.filter((d) => filterKind === 'all' || d.kind === filterKind),
    [deductions, filterKind]
  );

  const openAdd = () => {
    setError('');
    setStaffId(activeStaff[0]?.id || '');
    setKind('advance');
    setReason('');
    setTotalGhs('');
    setMonthlyGhs('');
    setStartMonth(currentPayMonth());
    setNotes('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const totalPesewas = ghsToPesewas(totalGhs);
      const monthlyPesewas = ghsToPesewas(monthlyGhs || totalGhs);
      await savePayrollDeduction(
        storeId,
        {
          staff_id: staffId,
          kind,
          reason,
          total_amount_pesewas: totalPesewas,
          monthly_repayment_pesewas: monthlyPesewas,
          start_month: startMonth,
          notes,
        },
        actor
      );
      await onRefresh();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save deduction.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, status: 'active' | 'paused' | 'cancelled') => {
    await updateDeductionStatus(storeId, id, status, actor);
    await onRefresh();
  };

  const totalOutstanding = deductions
    .filter((d) => d.status === 'active')
    .reduce((sum, d) => sum + d.remaining_balance_pesewas, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'loan', 'advance', 'fine'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilterKind(k)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                filterKind === k
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              {k === 'all' ? 'All' : KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openAdd} disabled={activeStaff.length === 0}>
          Add Loan / Advance / Fine
        </Button>
      </div>

      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/70">
        <div>
          <p className="text-xs text-muted">Active staff balances still owed to shop</p>
          <p className="text-lg font-bold text-ink">{formatPesewas(totalOutstanding)}</p>
        </div>
        <p className="text-xs text-muted">
          Scheduled repayments are automatically deducted when you lock a monthly pay run.
        </p>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-10 w-10 text-muted" />}
          title="No loans, advances, or fines"
          description="Record staff loans, mid-month salary advances, or stock shortage fines here to track repayment schedules automatically."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((ded) => {
            const staff = staffMap.get(ded.staff_id);
            const history = repayments.filter((r) => r.deduction_id === ded.id);
            const repaid = Math.max(0, ded.total_amount_pesewas - ded.remaining_balance_pesewas);
            const pct = ded.total_amount_pesewas > 0 ? Math.min(100, Math.round((repaid / ded.total_amount_pesewas) * 100)) : 100;

            return (
              <Card key={ded.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-sm font-bold text-ink">{staff?.full_name || 'Staff'}</h3>
                      <Badge tone={ded.kind === 'fine' ? 'danger' : ded.kind === 'loan' ? 'info' : 'warning'}>
                        {KIND_LABELS[ded.kind]}
                      </Badge>
                      <Badge
                        tone={
                          ded.status === 'active'
                            ? 'primary'
                            : ded.status === 'paid_off'
                              ? 'success'
                              : 'muted'
                        }
                      >
                        {ded.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink">{ded.reason}</p>
                    <p className="text-xs text-muted">
                      Starts {ded.start_month} · Deduct {formatPesewas(ded.monthly_repayment_pesewas)}/month
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">Remaining balance</p>
                    <p className="text-base font-bold text-ink">
                      {formatPesewas(ded.remaining_balance_pesewas)}
                    </p>
                    <p className="text-[11px] text-muted">
                      of {formatPesewas(ded.total_amount_pesewas)}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {pct}% repaid ({history.length} payment{history.length === 1 ? '' : 's'})
                  </span>
                  {ded.status !== 'paid_off' && ded.status !== 'cancelled' && (
                    <div className="flex gap-1.5">
                      {ded.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<PauseCircle className="h-3.5 w-3.5" />}
                          onClick={() => void handleStatus(ded.id, 'paused')}
                        >
                          Pause
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<PlayCircle className="h-3.5 w-3.5" />}
                          onClick={() => void handleStatus(ded.id, 'active')}
                        >
                          Resume
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<XCircle className="h-3.5 w-3.5" />}
                        onClick={() => void handleStatus(ded.id, 'cancelled')}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                {history.length > 0 && (
                  <details className="rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
                    <summary className="cursor-pointer font-semibold text-muted">
                      Repayment history ({history.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {history.map((h) => (
                        <div key={h.id} className="flex justify-between text-muted">
                          <span>Month {h.pay_month}</span>
                          <span>
                            Paid {formatPesewas(h.amount_pesewas)} · Balance left {formatPesewas(h.balance_after_pesewas)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleSave}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Record Loan, Advance, or Fine</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full p-2 text-muted hover:bg-black/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Staff member *</label>
                <select
                  required
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                >
                  {activeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.role_title})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['advance', 'loan', 'fine'] as PayrollDeductionKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                        kind === k
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-black/10 text-muted dark:border-white/10'
                      }`}
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Reason *</label>
                <input
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    kind === 'fine'
                      ? 'e.g. Stock shortage during month-end count'
                      : kind === 'loan'
                        ? 'e.g. Rent loan (4 months)'
                        : 'e.g. Mid-month salary advance'
                  }
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Total amount (GH₵) *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={totalGhs}
                    onChange={(e) => {
                      setTotalGhs(e.target.value);
                      if (kind === 'advance' && !monthlyGhs) setMonthlyGhs(e.target.value);
                    }}
                    placeholder="e.g. 500.00"
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Deduct per month (GH₵) *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={monthlyGhs}
                    onChange={(e) => setMonthlyGhs(e.target.value)}
                    placeholder="e.g. 250.00"
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Start deducting from month</label>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save Deduction
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

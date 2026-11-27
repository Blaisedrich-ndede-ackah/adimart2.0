import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  Landmark,
  Banknote,
  X,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { LocalStore } from '@/lib/dexie';
import { formatPesewas, ghsToPesewas, pesewasToGhs } from '@/lib/payroll/calculator';
import {
  addLockedPayRunAdjustment,
  advancePayRunStatus,
  generateOrRecalculatePayRun,
  getPayRunBundle,
  lockPayRun,
  markRunItemPaymentStatus,
  updateUnlockedRunItem,
  type PayrollActor,
} from '@/lib/payroll/store';
import { ACCOUNTANT_VERIFY_NOTICE } from '@/lib/payroll/taxDefaults';
import type {
  LocalPayrollAdjustment,
  LocalPayrollRules,
  LocalPayrollRun,
  LocalPayrollRunItem,
  LocalPayrollStaff,
  LocalPayrollTaxConfig,
  PayrollAdjustmentType,
  PayrollPaymentMethod,
} from '@/lib/payroll/types';
import PayslipModal from './PayslipModal';

interface PayRunFlowProps {
  store: LocalStore | null | undefined;
  storeId: string;
  payMonth: string;
  onChangeMonth: (month: string) => void;
  runs: LocalPayrollRun[];
  staffList: LocalPayrollStaff[];
  rules: LocalPayrollRules;
  activeTaxConfig: LocalPayrollTaxConfig | null;
  actor: PayrollActor;
  onRefresh: () => Promise<void>;
  onOpenSettings: () => void;
}

const STEPS = [
  { id: 'draft', label: '1. Calculate' },
  { id: 'reviewed', label: '2. Review' },
  { id: 'approved', label: '3. Approve' },
  { id: 'locked', label: '4. Locked' },
] as const;

export default function PayRunFlow({
  store,
  storeId,
  payMonth,
  onChangeMonth,
  runs,
  staffList,
  rules,
  activeTaxConfig,
  actor,
  onRefresh,
  onOpenSettings,
}: PayRunFlowProps) {
  const [subView, setSubView] = useState<'payslips' | 'payments'>('payslips');
  const [paymentFilter, setPaymentFilter] = useState<'all' | PayrollPaymentMethod>('all');
  const [bundle, setBundle] = useState<{
    run: LocalPayrollRun;
    items: LocalPayrollRunItem[];
    adjustments: LocalPayrollAdjustment[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modals
  const [viewingPayslip, setViewingPayslip] = useState<LocalPayrollRunItem | null>(null);
  const [editingItem, setEditingItem] = useState<LocalPayrollRunItem | null>(null);
  const [editDays, setEditDays] = useState('');
  const [editShifts, setEditShifts] = useState('');
  const [editOtHours, setEditOtHours] = useState('');
  const [editAbsent, setEditAbsent] = useState('');
  const [editBonusGhs, setEditBonusGhs] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [postToExpenses, setPostToExpenses] = useState(rules.post_to_expenses === 1);
  const [postToCashBook, setPostToCashBook] = useState(rules.post_to_cashbook === 1);

  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjItemId, setAdjItemId] = useState('');
  const [adjType, setAdjType] = useState<PayrollAdjustmentType>('bonus');
  const [adjSign, setAdjSign] = useState<'+' | '-'>('+');
  const [adjAmountGhs, setAdjAmountGhs] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [payingItem, setPayingItem] = useState<LocalPayrollRunItem | null>(null);
  const [payRef, setPayRef] = useState('');

  const currentRun = useMemo(() => runs.find((r) => r.pay_month === payMonth) || null, [runs, payMonth]);
  const staffMap = useMemo(() => new Map(staffList.map((s) => [s.id, s])), [staffList]);

  useEffect(() => {
    setPostToExpenses(rules.post_to_expenses === 1);
    setPostToCashBook(rules.post_to_cashbook === 1);
  }, [rules.post_to_expenses, rules.post_to_cashbook]);

  useEffect(() => {
    let active = true;
    if (!currentRun) {
      setBundle(null);
      return;
    }
    void getPayRunBundle(currentRun.id).then((res) => {
      if (active) setBundle(res);
    });
    return () => {
      active = false;
    };
  }, [currentRun, runs]);

  const reloadBundle = async (runId?: string) => {
    await onRefresh();
    const id = runId || currentRun?.id;
    if (id) {
      const next = await getPayRunBundle(id);
      setBundle(next);
    }
  };

  const handleCalculate = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { run } = await generateOrRecalculatePayRun(storeId, payMonth, actor);
      await reloadBundle(run.id);
      setNotice(`Calculated ${payMonth} payroll for ${run.staff_count} active staff.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not calculate payroll.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (status: 'reviewed' | 'approved') => {
    if (!bundle) return;
    setError('');
    setBusy(true);
    try {
      await advancePayRunStatus(storeId, bundle.run.id, status, actor);
      await reloadBundle(bundle.run.id);
      setNotice(
        status === 'reviewed'
          ? 'Pay run marked as Reviewed. Next step: Approve.'
          : 'Pay run Approved! You can now Lock the month and post wages to your books.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    if (!bundle) return;
    setError('');
    setBusy(true);
    try {
      await lockPayRun(storeId, bundle.run.id, { postToExpenses, postToCashBook }, actor);
      setLockModalOpen(false);
      await reloadBundle(bundle.run.id);
      setNotice(
        `Month ${bundle.run.pay_month} is now locked. Loan balances updated${
          postToExpenses || postToCashBook ? ' and wages posted to your books.' : '.'
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not lock pay run.');
    } finally {
      setBusy(false);
    }
  };

  const openEditItem = (item: LocalPayrollRunItem) => {
    setEditingItem(item);
    setEditDays(String(item.days_worked));
    setEditShifts(String(item.shifts_worked));
    setEditOtHours(String(Number((item.overtime_minutes / 60).toFixed(2))));
    setEditAbsent(String(item.absent_days));
    setEditBonusGhs(String(pesewasToGhs(item.bonus_pesewas)));
    setEditNotes(item.notes);
  };

  const handleSaveItemEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !bundle) return;
    setBusy(true);
    setError('');
    try {
      await updateUnlockedRunItem(
        storeId,
        editingItem.id,
        {
          days_worked: Number(editDays) || 0,
          shifts_worked: Number(editShifts) || 0,
          overtime_minutes: Math.round((Number(editOtHours) || 0) * 60),
          absent_days: Number(editAbsent) || 0,
          bonus_pesewas: ghsToPesewas(editBonusGhs),
          notes: editNotes,
        },
        actor
      );
      setEditingItem(null);
      await reloadBundle(bundle.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update payslip.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bundle) return;
    setBusy(true);
    setError('');
    try {
      const mag = ghsToPesewas(adjAmountGhs);
      const signed = adjSign === '-' ? -mag : mag;
      await addLockedPayRunAdjustment(
        storeId,
        {
          pay_run_id: bundle.run.id,
          run_item_id: adjItemId,
          adjustment_type: adjType,
          delta_net_pesewas: signed,
          reason: adjReason,
        },
        actor
      );
      setAdjModalOpen(false);
      setAdjAmountGhs('');
      setAdjReason('');
      await reloadBundle(bundle.run.id);
      setNotice('Logged adjustment recorded on this locked month.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log adjustment.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingItem || !bundle) return;
    setBusy(true);
    try {
      await markRunItemPaymentStatus(storeId, payingItem.id, 'paid', payRef, actor);
      setPayingItem(null);
      setPayRef('');
      await reloadBundle(bundle.run.id);
    } finally {
      setBusy(false);
    }
  };

  const filteredPaymentItems = useMemo(() => {
    if (!bundle) return [];
    return bundle.items.filter((i) => paymentFilter === 'all' || i.payment_method === paymentFilter);
  }, [bundle, paymentFilter]);

  const paidCount = bundle ? bundle.items.filter((i) => i.payment_status === 'paid').length : 0;
  const totalAdjustmentsNet = bundle
    ? bundle.adjustments.reduce((s, a) => s + a.delta_net_pesewas, 0)
    : 0;

  return (
    <div className="space-y-4">
      {/* Unverified tax rates reminder */}
      {activeTaxConfig && activeTaxConfig.verified_with_accountant !== 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold">Ghana PAYE & SSNIT rates: Verify with your accountant</p>
              <p className="text-xs opacity-90">{ACCOUNTANT_VERIFY_NOTICE}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onOpenSettings}>
            Review Rates
          </Button>
        </div>
      )}

      {/* Month Selector & Primary Action */}
      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-muted">Pay month</label>
          <input
            type="month"
            value={payMonth}
            onChange={(e) => onChangeMonth(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-ink dark:border-white/15 dark:bg-slate-900"
          />
          {bundle && (
            <Badge
              tone={
                bundle.run.status === 'locked'
                  ? 'success'
                  : bundle.run.status === 'approved'
                    ? 'info'
                    : bundle.run.status === 'reviewed'
                      ? 'warning'
                      : 'muted'
              }
              size="md"
            >
              {bundle.run.status === 'locked' && <Lock className="h-3.5 w-3.5" />}
              {bundle.run.status.toUpperCase()}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(!bundle || bundle.run.status !== 'locked') && (
            <Button
              loading={busy}
              variant={bundle ? 'secondary' : 'primary'}
              leftIcon={bundle ? <RefreshCw className="h-4 w-4" /> : <Calculator className="h-4 w-4" />}
              onClick={() => void handleCalculate()}
            >
              {bundle ? 'Recalculate' : `Calculate ${payMonth} Payroll`}
            </Button>
          )}
          {bundle?.run.status === 'draft' && (
            <Button
              loading={busy}
              leftIcon={<ClipboardCheck className="h-4 w-4" />}
              onClick={() => void handleAdvance('reviewed')}
            >
              Mark Reviewed
            </Button>
          )}
          {bundle?.run.status === 'reviewed' && (
            <Button
              loading={busy}
              variant="success"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() => void handleAdvance('approved')}
            >
              Approve Pay Run
            </Button>
          )}
          {bundle?.run.status === 'approved' && (
            <Button
              loading={busy}
              variant="primary"
              leftIcon={<Lock className="h-4 w-4" />}
              onClick={() => setLockModalOpen(true)}
            >
              Lock Month & Post to Books
            </Button>
          )}
          {bundle?.run.status === 'locked' && (
            <Button
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setAdjItemId(bundle.items[0]?.id || '');
                setAdjType('bonus');
                setAdjSign('+');
                setAdjAmountGhs('');
                setAdjReason('');
                setAdjModalOpen(true);
              }}
            >
              Log Adjustment
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {/* Step progress bar */}
      {bundle && (
        <div className="grid grid-cols-4 gap-1.5">
          {STEPS.map((step, idx) => {
            const currentIdx = STEPS.findIndex((s) => s.id === bundle.run.status);
            const active = idx <= currentIdx;
            return (
              <div
                key={step.id}
                className={`rounded-xl px-2 py-2 text-center text-[11px] font-semibold ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200/70 text-muted dark:bg-slate-800'
                }`}
              >
                {step.label}
              </div>
            );
          })}
        </div>
      )}

      {!bundle ? (
        <EmptyState
          icon={<Calculator className="h-10 w-10 text-muted" />}
          title={`No payroll calculated for ${payMonth}`}
          description="Tap Calculate Payroll to compute basic pay, allowances, attendance/overtime, POS cashier commissions, SSNIT, PAYE, and loan repayments for every active staff member."
          action={
            <Button loading={busy} leftIcon={<Calculator className="h-4 w-4" />} onClick={() => void handleCalculate()}>
              Calculate {payMonth} Payroll
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Card padding="sm">
              <p className="text-[11px] font-medium text-muted">Take-home pay (Net)</p>
              <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {formatPesewas(bundle.run.total_net_pesewas + totalAdjustmentsNet)}
              </p>
              <p className="text-[11px] text-muted">{paidCount} of {bundle.items.length} paid</p>
            </Card>
            <Card padding="sm">
              <p className="text-[11px] font-medium text-muted">Total cost to shop</p>
              <p className="mt-1 text-lg font-bold text-ink">
                {formatPesewas(bundle.run.total_employer_cost_pesewas + totalAdjustmentsNet)}
              </p>
              <p className="text-[11px] text-muted">
                Gross + Employer SSNIT ({formatPesewas(bundle.run.total_ssnit_employer_pesewas)})
              </p>
            </Card>
            <Card padding="sm">
              <p className="text-[11px] font-medium text-muted">PAYE tax (to GRA)</p>
              <p className="mt-1 text-lg font-bold text-ink">
                {formatPesewas(bundle.run.total_paye_pesewas)}
              </p>
              <p className="text-[11px] text-muted">Due 15th next month</p>
            </Card>
            <Card padding="sm">
              <p className="text-[11px] font-medium text-muted">Total SSNIT to remit</p>
              <p className="mt-1 text-lg font-bold text-ink">
                {formatPesewas(bundle.run.total_ssnit_employee_pesewas + bundle.run.total_ssnit_employer_pesewas)}
              </p>
              <p className="text-[11px] text-muted">Emp + Employer share</p>
            </Card>
          </div>

          {/* Toggle between Payslips Review & Payment List */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSubView('payslips')}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                subView === 'payslips'
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              Staff Payslips ({bundle.items.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView('payments')}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                subView === 'payments'
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              Payment List ({paidCount}/{bundle.items.length} paid)
            </button>
          </div>

          {subView === 'payslips' ? (
            <div className="space-y-3">
              {bundle.items.map((item) => {
                const itemAdjs = bundle.adjustments.filter((a) => a.run_item_id === item.id);
                const adjSum = itemAdjs.reduce((s, a) => s + a.delta_net_pesewas, 0);
                return (
                  <Card key={item.id} className="space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h4 className="text-base font-bold text-ink">{item.staff_name}</h4>
                          <Badge tone={item.payment_status === 'paid' ? 'success' : 'muted'}>
                            {item.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted">
                          {item.role_title} · {item.location_name || 'Main Shop'} · {item.days_worked}d worked
                          {item.overtime_minutes > 0 ? ` · ${(item.overtime_minutes / 60).toFixed(1)}h OT` : ''}
                          {item.absent_days > 0 ? ` · ${item.absent_days}d absent` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-muted">Take-home pay</p>
                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                          {formatPesewas(item.net_pay_pesewas + adjSum)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-2.5 text-xs sm:grid-cols-4 dark:bg-slate-800/60">
                      <div>
                        <span className="text-muted">Gross pay:</span>{' '}
                        <strong className="text-ink">{formatPesewas(item.gross_pay_pesewas)}</strong>
                      </div>
                      <div>
                        <span className="text-muted">SSNIT (emp):</span>{' '}
                        <strong className="text-ink">{formatPesewas(item.ssnit_employee_pesewas)}</strong>
                      </div>
                      <div>
                        <span className="text-muted">PAYE tax:</span>{' '}
                        <strong className="text-ink">{formatPesewas(item.paye_pesewas)}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Loans / fines:</span>{' '}
                        <strong className="text-ink">{formatPesewas(item.total_other_deductions_pesewas)}</strong>
                      </div>
                    </div>

                    {(item.commission_pesewas > 0 || item.bonus_pesewas > 0 || item.overtime_pay_pesewas > 0) && (
                      <div className="flex flex-wrap gap-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                        {item.overtime_pay_pesewas > 0 && (
                          <span>+ Overtime {formatPesewas(item.overtime_pay_pesewas)}</span>
                        )}
                        {item.commission_pesewas > 0 && (
                          <span>+ Commission {formatPesewas(item.commission_pesewas)}</span>
                        )}
                        {item.bonus_pesewas > 0 && (
                          <span>+ Bonus {formatPesewas(item.bonus_pesewas)}</span>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-muted">
                        Shop cost: {formatPesewas(item.employer_cost_pesewas + adjSum)} (incl. {formatPesewas(item.ssnit_employer_pesewas)} employer SSNIT)
                      </span>
                      <div className="flex gap-2">
                        {bundle.run.status !== 'locked' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<Pencil className="h-3.5 w-3.5" />}
                            onClick={() => openEditItem(item)}
                          >
                            Edit / Bonus
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="primary"
                          leftIcon={<FileText className="h-3.5 w-3.5" />}
                          onClick={() => setViewingPayslip(item)}
                        >
                          Payslip
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {/* Locked adjustments list */}
              {bundle.adjustments.length > 0 && (
                <Card className="border border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30">
                  <h4 className="mb-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                    Logged Post-Lock Adjustments ({bundle.adjustments.length})
                  </h4>
                  <div className="space-y-2 text-xs">
                    {bundle.adjustments.map((adj) => (
                      <div key={adj.id} className="flex justify-between gap-2 border-b border-amber-200/70 pb-1.5 last:border-b-0">
                        <div>
                          <p className="font-semibold text-ink">
                            {adj.staff_name} · <span className="capitalize">{adj.adjustment_type}</span>
                          </p>
                          <p className="text-muted">
                            {adj.reason} — logged by {adj.created_by_name} on {adj.created_at.slice(0, 10)}
                          </p>
                        </div>
                        <span className={`font-bold ${adj.delta_net_pesewas >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {adj.delta_net_pesewas >= 0 ? '+' : ''}
                          {formatPesewas(adj.delta_net_pesewas)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            /* Payment List View */
            <div className="space-y-3">
              <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                <strong>Payment list:</strong> Send each staff member’s take-home pay via MoMo, Bank transfer, or Cash, then tap <strong>Mark Paid</strong>. Automated Paystack bulk transfers will be added in a later phase.
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(['all', 'momo', 'bank', 'cash'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentFilter(m)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      paymentFilter === m
                        ? 'bg-primary text-white'
                        : 'bg-white text-muted shadow-xs dark:bg-slate-900'
                    }`}
                  >
                    {m === 'all' ? 'All methods' : m === 'momo' ? 'MoMo' : m === 'bank' ? 'Bank' : 'Cash'}
                  </button>
                ))}
              </div>

              {filteredPaymentItems.map((item) => {
                const adjSum = bundle.adjustments
                  .filter((a) => a.run_item_id === item.id)
                  .reduce((s, a) => s + a.delta_net_pesewas, 0);
                const payable = item.net_pay_pesewas + adjSum;
                const Icon =
                  item.payment_method === 'momo'
                    ? Smartphone
                    : item.payment_method === 'bank'
                      ? Landmark
                      : Banknote;
                return (
                  <Card key={item.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-bold text-ink">{item.staff_name}</span>
                        <Badge tone={item.payment_status === 'paid' ? 'success' : 'warning'}>
                          {item.payment_status === 'paid' ? 'Paid' : 'To pay'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{item.payment_destination}</p>
                      {item.payment_status === 'paid' && item.paid_at && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          Paid on {item.paid_at.slice(0, 10)}
                          {item.payment_reference ? ` · Ref: ${item.payment_reference}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-base font-bold text-ink">{formatPesewas(payable)}</p>
                        <p className="text-[11px] uppercase text-muted">{item.payment_method}</p>
                      </div>
                      {item.payment_status === 'paid' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await markRunItemPaymentStatus(storeId, item.id, 'unpaid', '', actor);
                            await reloadBundle(bundle.run.id);
                          }}
                        >
                          Undo
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="success"
                          leftIcon={<Send className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setPayingItem(item);
                            setPayRef('');
                          }}
                        >
                          Mark Paid
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Payslip Modal */}
      {viewingPayslip && bundle && (
        <PayslipModal
          store={store}
          item={viewingPayslip}
          adjustments={bundle.adjustments.filter((a) => a.run_item_id === viewingPayslip.id)}
          staffPhone={staffMap.get(viewingPayslip.staff_id)?.phone || ''}
          onClose={() => setViewingPayslip(null)}
        />
      )}

      {/* Edit Unlocked Staff Pay Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleSaveItemEdit}
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink">Adjust {editingItem.staff_name}</h3>
                <p className="text-xs text-muted">SSNIT, PAYE & net pay recalculate automatically.</p>
              </div>
              <button type="button" onClick={() => setEditingItem(null)} className="rounded-full p-2 text-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Days worked</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editDays}
                  onChange={(e) => setEditDays(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Shifts worked</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editShifts}
                  onChange={(e) => setEditShifts(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Overtime hours</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editOtHours}
                  onChange={(e) => setEditOtHours(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Absent days (unpaid)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editAbsent}
                  onChange={(e) => setEditAbsent(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-semibold text-ink">Bonus (GH₵)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editBonusGhs}
                  onChange={(e) => setEditBonusGhs(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-semibold text-ink">Note</label>
                <input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional note on payslip"
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingItem(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>Recalculate & Save</Button>
            </div>
          </form>
        </div>
      )}

      {/* Lock Month Confirmation Modal */}
      {lockModalOpen && bundle && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-ink">Lock {bundle.run.pay_month} Payroll?</h3>
            <p className="mt-1 text-xs text-muted">
              Once locked, this month cannot be edited directly — any future correction must be recorded as a logged adjustment. Active staff loan/advance/fine balances will be reduced automatically.
            </p>
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
              <div className="flex justify-between">
                <span>Total employer payroll cost:</span>
                <strong>{formatPesewas(bundle.run.total_employer_cost_pesewas)}</strong>
              </div>
              <label className="flex items-start gap-2 pt-1 text-ink">
                <input
                  type="checkbox"
                  checked={postToExpenses}
                  onChange={(e) => setPostToExpenses(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Post to <strong>Expense Reports</strong> (category: Salaries) so Profit reports include wages.
                </span>
              </label>
              <label className="flex items-start gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={postToCashBook}
                  onChange={(e) => setPostToCashBook(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Post to <strong>Cash Book</strong> (category: Salaries) so cash flow tracks wage outflows.
                </span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setLockModalOpen(false)}>Cancel</Button>
              <Button loading={busy} leftIcon={<Lock className="h-4 w-4" />} onClick={() => void handleLock()}>
                Lock Month
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Logged Adjustment Modal (Locked Month Only) */}
      {adjModalOpen && bundle && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleLogAdjustment}
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink">Log Locked-Month Adjustment</h3>
                <p className="text-xs text-muted">
                  Recorded permanently in the audit log without altering the original locked payslip.
                </p>
              </div>
              <button type="button" onClick={() => setAdjModalOpen(false)} className="rounded-full p-2 text-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Staff member</label>
                <select
                  value={adjItemId}
                  onChange={(e) => setAdjItemId(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                >
                  {bundle.items.map((i) => (
                    <option key={i.id} value={i.id}>{i.staff_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Type</label>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as PayrollAdjustmentType)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  >
                    <option value="bonus">Bonus / Extra pay</option>
                    <option value="correction">Pay correction</option>
                    <option value="allowance">Missed allowance</option>
                    <option value="reimbursement">Reimbursement</option>
                    <option value="deduction">Post-lock deduction</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Direction</label>
                  <select
                    value={adjSign}
                    onChange={(e) => setAdjSign(e.target.value as '+' | '-')}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  >
                    <option value="+">Add (+ owed to staff)</option>
                    <option value="-">Subtract (- deducted)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Amount (GH₵) *</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={adjAmountGhs}
                  onChange={(e) => setAdjAmountGhs(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Reason *</label>
                <input
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. Missed 3 hours overtime on 28th"
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdjModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save Adjustment</Button>
            </div>
          </form>
        </div>
      )}

      {/* Mark Paid Modal */}
      {payingItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleConfirmPaid}
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-ink">Mark {payingItem.staff_name} as Paid</h3>
            <p className="mt-1 text-xs text-muted">
              {payingItem.payment_method.toUpperCase()} · {payingItem.payment_destination}
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-ink">
                Transaction reference / receipt note (optional)
              </label>
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. MoMo TXN 4589123 or Cash signed"
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPayingItem(null)}>Cancel</Button>
              <Button type="submit" variant="success" loading={busy}>Confirm Paid</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

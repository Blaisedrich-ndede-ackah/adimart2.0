import { Download, MessageCircle, Printer, X, CheckCircle2, Clock } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import type { LocalStore } from '@/lib/dexie';
import { formatPesewas } from '@/lib/payroll/calculator';
import {
  buildPayslipWhatsAppText,
  exportPayslipPdf,
  printPayslip,
  sharePayslipViaWhatsApp,
} from '@/lib/payroll/pdf';
import { parseAllowances } from '@/lib/payroll/store';
import type {
  AppliedLoanDeduction,
  LocalPayrollAdjustment,
  LocalPayrollRunItem,
  PayeBandSlice,
} from '@/lib/payroll/types';

function safeParseArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export interface PayslipCardProps {
  store: LocalStore | null | undefined;
  item: LocalPayrollRunItem;
  adjustments?: LocalPayrollAdjustment[];
  staffPhone?: string;
  onClose?: () => void;
}

export function PayslipCard({
  store,
  item,
  adjustments = [],
  staffPhone = '',
  onClose,
}: PayslipCardProps) {
  const allowances = parseAllowances(item.allowances_json);
  const loanDeductions = safeParseArray<AppliedLoanDeduction>(item.loan_deductions_json);
  const payeSlices = safeParseArray<PayeBandSlice>(item.paye_breakdown_json);
  const adjTotal = adjustments.reduce((sum, a) => sum + a.delta_net_pesewas, 0);
  const finalNet = item.net_pay_pesewas + adjTotal;
  const storeName = store?.name || 'Shop';

  const handleWhatsApp = () => {
    const text = buildPayslipWhatsAppText(storeName, item, adjustments);
    sharePayslipViaWhatsApp(staffPhone, text);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-ink">{item.staff_name}</h3>
            <Badge tone={item.payment_status === 'paid' ? 'success' : 'warning'}>
              {item.payment_status === 'paid' ? (
                <><CheckCircle2 className="h-3 w-3" /> Paid</>
              ) : (
                <><Clock className="h-3 w-3" /> Pending</>
              )}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            {item.role_title} · {item.location_name || 'Main Shop'} · Month {item.pay_month}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payslip"
            className="rounded-full p-2 text-muted hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Take-home highlight */}
      <div className="rounded-2xl bg-emerald-600 p-4 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
          Take-Home Pay (Net Pay)
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight">
          {formatPesewas(finalNet)}
        </p>
        <p className="mt-1 text-xs text-emerald-100">
          Pay via {item.payment_method.toUpperCase()} · {item.payment_destination}
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={() => exportPayslipPdf(store, item, adjustments)}
        >
          PDF
        </Button>
        <Button
          size="sm"
          variant="success"
          leftIcon={<MessageCircle className="h-4 w-4" />}
          onClick={handleWhatsApp}
        >
          WhatsApp
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Printer className="h-4 w-4" />}
          onClick={() => printPayslip(storeName, item, adjustments)}
        >
          Print
        </Button>
      </div>

      {/* Earnings */}
      <div className="rounded-xl border border-black/10 bg-white p-3.5 dark:border-white/10 dark:bg-slate-900/60">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Earnings (What you earned)
        </h4>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-ink">
              Basic pay ({item.pay_type.replace('_', ' ')} · {item.days_worked}d)
            </span>
            <span className="font-medium text-ink">{formatPesewas(item.basic_pay_pesewas)}</span>
          </div>
          {item.absence_deduction_pesewas > 0 && (
            <div className="flex justify-between gap-2 text-red-600 dark:text-red-400">
              <span>Unpaid absence ({item.absent_days} day{item.absent_days === 1 ? '' : 's'})</span>
              <span className="font-medium">-{formatPesewas(item.absence_deduction_pesewas)}</span>
            </div>
          )}
          {allowances.map((a) => (
            <div key={a.id} className="flex justify-between gap-2">
              <span className="text-ink">
                {a.name} allowance{a.is_taxable ? '' : ' (tax-free)'}
              </span>
              <span className="font-medium text-ink">{formatPesewas(a.amount_pesewas)}</span>
            </div>
          ))}
          {item.overtime_pay_pesewas > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-ink">
                Overtime ({(item.overtime_minutes / 60).toFixed(1)} hrs)
              </span>
              <span className="font-medium text-ink">{formatPesewas(item.overtime_pay_pesewas)}</span>
            </div>
          )}
          {item.commission_pesewas > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-ink">
                Sales commission (POS sales {formatPesewas(item.sales_total_pesewas)})
              </span>
              <span className="font-medium text-ink">{formatPesewas(item.commission_pesewas)}</span>
            </div>
          )}
          {item.bonus_pesewas > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-ink">Bonus</span>
              <span className="font-medium text-ink">{formatPesewas(item.bonus_pesewas)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between gap-2 border-t border-black/10 pt-2 font-semibold dark:border-white/10">
            <span className="text-ink">Gross pay (Total before deductions)</span>
            <span className="text-ink">{formatPesewas(item.gross_pay_pesewas)}</span>
          </div>
        </div>
      </div>

      {/* Deductions */}
      <div className="rounded-xl border border-black/10 bg-white p-3.5 dark:border-white/10 dark:bg-slate-900/60">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Deductions (What is taken out)
        </h4>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <div>
              <p className="text-ink">SSNIT pension (your share)</p>
              <p className="text-[11px] text-muted">
                Calculated on {formatPesewas(item.ssnit_pensionable_pesewas)} pensionable pay
              </p>
            </div>
            <span className="font-medium text-red-600 dark:text-red-400">
              -{formatPesewas(item.ssnit_employee_pesewas)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <div>
              <p className="text-ink">PAYE income tax (GRA)</p>
              <p className="text-[11px] text-muted">
                Taxable pay after SSNIT: {formatPesewas(item.chargeable_income_pesewas)}
              </p>
            </div>
            <span className="font-medium text-red-600 dark:text-red-400">
              -{formatPesewas(item.paye_pesewas)}
            </span>
          </div>
          {loanDeductions.map((d) => (
            <div key={d.deduction_id} className="flex justify-between gap-2">
              <div>
                <p className="text-ink capitalize">
                  {d.kind}: {d.reason}
                </p>
                <p className="text-[11px] text-muted">
                  Balance left after this month: {formatPesewas(d.remaining_after_pesewas)}
                </p>
              </div>
              <span className="font-medium text-red-600 dark:text-red-400">
                -{formatPesewas(d.applied_pesewas)}
              </span>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-2 border-t border-black/10 pt-2 font-semibold dark:border-white/10">
            <span className="text-ink">Total deductions</span>
            <span className="text-red-600 dark:text-red-400">
              -{formatPesewas(item.total_deductions_pesewas)}
            </span>
          </div>
        </div>

        {/* Optional PAYE band breakdown */}
        {payeSlices.length > 0 && item.paye_pesewas > 0 && (
          <details className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
            <summary className="cursor-pointer font-semibold text-muted">
              How PAYE tax was calculated ({payeSlices.length} bands)
            </summary>
            <div className="mt-2 space-y-1">
              {payeSlices.map((s, idx) => (
                <div key={idx} className="flex justify-between gap-2 text-muted">
                  <span className="truncate">
                    {s.label} ({(s.rate_bps / 100).toFixed(1)}%) on {formatPesewas(s.taxable_pesewas)}
                  </span>
                  <span className="font-medium text-ink">{formatPesewas(s.tax_pesewas)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Logged adjustments on locked months */}
      {adjustments.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-700 dark:bg-amber-950/30">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            Logged Adjustments (After Month Lock)
          </h4>
          <div className="space-y-1.5 text-sm">
            {adjustments.map((adj) => (
              <div key={adj.id} className="flex justify-between gap-2">
                <div>
                  <p className="font-medium capitalize text-ink">
                    {adj.adjustment_type}: {adj.reason}
                  </p>
                  <p className="text-[11px] text-muted">
                    By {adj.created_by_name} on {adj.created_at.slice(0, 10)}
                  </p>
                </div>
                <span className={`font-semibold ${adj.delta_net_pesewas >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {adj.delta_net_pesewas >= 0 ? '+' : ''}
                  {formatPesewas(adj.delta_net_pesewas)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Employer pension info */}
      <div className="rounded-xl bg-slate-100 p-3 text-xs text-muted dark:bg-slate-800/70">
        <div className="flex justify-between gap-2">
          <span>Shop’s SSNIT contribution (paid by employer, not deducted from you)</span>
          <span className="font-semibold text-ink">{formatPesewas(item.ssnit_employer_pesewas)}</span>
        </div>
      </div>
    </div>
  );
}

export default function PayslipModal(props: PayslipCardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-slate-50 p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-slate-950">
        <PayslipCard {...props} />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Download,
  FileSpreadsheet,
  History,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { LocalStore } from '@/lib/dexie';
import { formatPesewas } from '@/lib/payroll/calculator';
import { exportComplianceSummaryPdf, exportYearEndReportPdf } from '@/lib/payroll/pdf';
import {
  buildMonthlyComplianceSummary,
  buildShopCostBreakdown,
  buildYearEndStaffReport,
  listPayrollAuditLogs,
  todayDateOnly,
  type MonthlyComplianceSummary,
  type ShopCostRow,
  type YearEndStaffRow,
} from '@/lib/payroll/store';
import type { LocalPayrollAuditLog } from '@/lib/payroll/types';

interface ComplianceReportsProps {
  store: LocalStore | null | undefined;
  storeId: string;
  payMonth: string;
  onChangeMonth: (month: string) => void;
  refreshTick: number;
}

export default function ComplianceReports({
  store,
  storeId,
  payMonth,
  onChangeMonth,
  refreshTick,
}: ComplianceReportsProps) {
  const [section, setSection] = useState<'statutory' | 'shops' | 'yearend' | 'audit'>('statutory');
  const [year, setYear] = useState(() => Number(payMonth.slice(0, 4)) || new Date().getFullYear());
  const [summary, setSummary] = useState<MonthlyComplianceSummary | null>(null);
  const [shopRows, setShopRows] = useState<ShopCostRow[]>([]);
  const [yearEndRows, setYearEndRows] = useState<YearEndStaffRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<LocalPayrollAuditLog[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      buildMonthlyComplianceSummary(storeId, payMonth),
      buildShopCostBreakdown(storeId, payMonth),
      buildYearEndStaffReport(storeId, year),
      listPayrollAuditLogs(storeId, 200),
    ]).then(([s, shops, ye, logs]) => {
      if (!active) return;
      setSummary(s);
      setShopRows(shops);
      setYearEndRows(ye);
      setAuditLogs(logs);
    });
    return () => {
      active = false;
    };
  }, [storeId, payMonth, year, refreshTick]);

  const today = todayDateOnly();
  const isOverdue = summary ? today > summary.dueDate : false;
  const totalShopCost = shopRows.reduce((s, r) => s + r.employerCostPesewas, 0);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { id: 'statutory', label: 'PAYE & SSNIT Filing', icon: ShieldCheck },
          { id: 'shops', label: 'Cost by Shop', icon: Building2 },
          { id: 'yearend', label: 'Year-End Report', icon: FileSpreadsheet },
          { id: 'audit', label: 'Audit Trail', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id as typeof section)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                section === tab.id
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 1. Monthly PAYE & SSNIT Filing Summary + Employer Cost View */}
      {section === 'statutory' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-muted">Month</label>
              <input
                type="month"
                value={payMonth}
                onChange={(e) => onChangeMonth(e.target.value)}
                className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-900"
              />
            </div>
            {summary && (
              <Button
                size="sm"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={() => exportComplianceSummaryPdf(store, summary)}
              >
                Download Filing PDF
              </Button>
            )}
          </div>

          {!summary ? (
            <EmptyState
              icon={<CalendarClock className="h-10 w-10 text-muted" />}
              title={`No pay run for ${payMonth}`}
              description="Calculate a pay run for this month first to generate your GRA PAYE and SSNIT filing summary."
            />
          ) : (
            <>
              {/* Filing deadline banner */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3.5 text-sm ${
                  isOverdue
                    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">
                      Filing due by {summary.dueDate} (15th of the following month)
                    </p>
                    <p className="text-xs opacity-90">
                      Submit monthly PAYE to GRA and Tier 1 + Tier 2 SSNIT schedules on or before this date to avoid penalties.
                    </p>
                  </div>
                </div>
                <Badge tone={isOverdue ? 'danger' : 'success'}>
                  {isOverdue ? 'Past due date' : 'Filing reminder'}
                </Badge>
              </div>

              {!summary.taxVerified && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    Rates used for this run have not yet been marked verified. Confirm PAYE bands & SSNIT cap with your accountant before filing.
                  </span>
                </div>
              )}

              {/* Employer Cost View & Remittance Cards */}
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Card padding="sm">
                  <p className="text-[11px] text-muted">PAYE to remit (GRA)</p>
                  <p className="mt-1 text-lg font-bold text-ink">
                    {formatPesewas(summary.totalPayeRemittancePesewas)}
                  </p>
                </Card>
                <Card padding="sm">
                  <p className="text-[11px] text-muted">SSNIT to remit (Total)</p>
                  <p className="mt-1 text-lg font-bold text-ink">
                    {formatPesewas(summary.totalSsnitRemittancePesewas)}
                  </p>
                  <p className="text-[11px] text-muted">
                    Emp {formatPesewas(summary.totalSsnitEmployeePesewas)} + Shop {formatPesewas(summary.totalSsnitEmployerPesewas)}
                  </p>
                </Card>
                <Card padding="sm">
                  <p className="text-[11px] text-muted">Total Gross Pay</p>
                  <p className="mt-1 text-lg font-bold text-ink">
                    {formatPesewas(summary.totalGrossPesewas)}
                  </p>
                </Card>
                <Card padding="sm" className="bg-emerald-50/70 dark:bg-emerald-950/30">
                  <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                    Total Employer Cost
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {formatPesewas(summary.totalEmployerCostPesewas)}
                  </p>
                  <p className="text-[11px] text-muted">Gross + Employer SSNIT</p>
                </Card>
              </div>

              {/* Staff Schedule */}
              <Card className="overflow-x-auto">
                <h4 className="mb-3 text-sm font-bold text-ink">
                  Staff Filing Schedule ({summary.payMonth})
                </h4>
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-muted dark:border-white/10">
                      <th className="py-2 pr-2">Staff</th>
                      <th className="py-2 pr-2">SSNIT / TIN</th>
                      <th className="py-2 pr-2 text-right">Gross</th>
                      <th className="py-2 pr-2 text-right">SSNIT (Emp)</th>
                      <th className="py-2 pr-2 text-right">SSNIT (Shop)</th>
                      <th className="py-2 pr-2 text-right">PAYE</th>
                      <th className="py-2 text-right">Employer Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {summary.staffLines.map((line) => (
                      <tr key={line.staffId}>
                        <td className="py-2 pr-2 font-semibold text-ink">{line.staffName}</td>
                        <td className="py-2 pr-2 text-muted">
                          {[line.ssnitNumber, line.tinNumber].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="py-2 pr-2 text-right">{formatPesewas(line.grossPesewas)}</td>
                        <td className="py-2 pr-2 text-right">{formatPesewas(line.ssnitEmployeePesewas)}</td>
                        <td className="py-2 pr-2 text-right">{formatPesewas(line.ssnitEmployerPesewas)}</td>
                        <td className="py-2 pr-2 text-right">{formatPesewas(line.payePesewas)}</td>
                        <td className="py-2 text-right font-semibold text-ink">
                          {formatPesewas(line.employerCostPesewas)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* 2. Payroll Cost Per Shop / Branch */}
      {section === 'shops' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted">Month</label>
            <input
              type="month"
              value={payMonth}
              onChange={(e) => onChangeMonth(e.target.value)}
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-900"
            />
          </div>
          {shopRows.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-10 w-10 text-muted" />}
              title={`No shop wage data for ${payMonth}`}
              description="Run payroll for this month to see what wages cost each shop or branch."
            />
          ) : (
            <div className="space-y-2.5">
              {shopRows.map((shop) => {
                const share = totalShopCost > 0 ? Math.round((shop.employerCostPesewas / totalShopCost) * 100) : 0;
                return (
                  <Card key={shop.locationId} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-base font-bold text-ink">{shop.locationName}</h4>
                        <p className="text-xs text-muted">
                          {shop.staffCount} staff · {share}% of total wage cost
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted">Total cost to shop</p>
                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                          {formatPesewas(shop.employerCostPesewas)}
                        </p>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted">
                      <span>Gross: <strong className="text-ink">{formatPesewas(shop.grossPesewas)}</strong></span>
                      <span>Shop SSNIT: <strong className="text-ink">{formatPesewas(shop.employerSsnitPesewas)}</strong></span>
                      <span>Net pay: <strong className="text-ink">{formatPesewas(shop.netPayPesewas)}</strong></span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Year-End Staff Report */}
      {section === 'yearend' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-muted">Tax year</label>
              <input
                type="number"
                min="2020"
                max="2040"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                className="w-28 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-ink dark:border-white/15 dark:bg-slate-900"
              />
            </div>
            {yearEndRows.length > 0 && (
              <Button
                size="sm"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={() => exportYearEndReportPdf(store, year, yearEndRows)}
              >
                Download Year-End PDF
              </Button>
            )}
          </div>

          {yearEndRows.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-10 w-10 text-muted" />}
              title={`No approved or locked pay runs in ${year}`}
              description="Once monthly pay runs are approved or locked, each staff member’s annual earnings and deductions appear here automatically."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b border-black/10 text-muted dark:border-white/10">
                    <th className="py-2 pr-2">Staff</th>
                    <th className="py-2 pr-2 text-right">Months</th>
                    <th className="py-2 pr-2 text-right">Gross</th>
                    <th className="py-2 pr-2 text-right">SSNIT (Emp)</th>
                    <th className="py-2 pr-2 text-right">PAYE</th>
                    <th className="py-2 pr-2 text-right">Loans/Fines</th>
                    <th className="py-2 pr-2 text-right">Net Paid</th>
                    <th className="py-2 text-right">Employer Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {yearEndRows.map((row) => (
                    <tr key={row.staffId}>
                      <td className="py-2 pr-2">
                        <p className="font-semibold text-ink">{row.staffName}</p>
                        <p className="text-[11px] text-muted">{row.roleTitle}</p>
                      </td>
                      <td className="py-2 pr-2 text-right">{row.monthsPaid}</td>
                      <td className="py-2 pr-2 text-right">{formatPesewas(row.totalGrossPesewas)}</td>
                      <td className="py-2 pr-2 text-right">{formatPesewas(row.totalSsnitEmployeePesewas)}</td>
                      <td className="py-2 pr-2 text-right">{formatPesewas(row.totalPayePesewas)}</td>
                      <td className="py-2 pr-2 text-right">{formatPesewas(row.totalOtherDeductionsPesewas)}</td>
                      <td className="py-2 pr-2 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatPesewas(row.totalNetPesewas)}
                      </td>
                      <td className="py-2 text-right font-semibold text-ink">
                        {formatPesewas(row.totalEmployerCostPesewas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* 4. Audit Trail */}
      {section === 'audit' && (
        <Card className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-ink">Payroll Audit Trail</h4>
            <Badge tone="muted">{auditLogs.length} entries</Badge>
          </div>
          {auditLogs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              Every salary change, tax rate update, pay run approval, lock, and adjustment will be logged here with who made it and when.
            </p>
          ) : (
            <div className="divide-y divide-black/10 dark:divide-white/10">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold text-ink">{log.summary}</span>
                    <Badge tone="muted">{log.entity_type.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    By {log.actor_name} · {new Date(log.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

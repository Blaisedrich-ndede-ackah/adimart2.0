import { FormalPdf, orgFromStore } from '@/lib/formalPdf';
import type { LocalStore } from '@/lib/dexie';
import { parseGhanaPhone } from '@/lib/ghanaPhone';
import { formatPesewas, pesewasToGhs } from './calculator';
import { formatOfficialMoney } from '@/lib/currency';
import { parseAllowances, type MonthlyComplianceSummary, type YearEndStaffRow } from './store';
import type {
  AppliedLoanDeduction,
  LocalPayrollAdjustment,
  LocalPayrollRunItem,
  PayeBandSlice,
} from './types';

function pdfMoney(pesewas: number, currencyCode?: string | null): string {
  return formatOfficialMoney(pesewasToGhs(pesewas), currencyCode);
}

function parseJsonArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function exportPayslipPdf(
  store: LocalStore | null | undefined,
  item: LocalPayrollRunItem,
  adjustments: LocalPayrollAdjustment[] = []
): void {
  const org = orgFromStore(store);
  const cc = store?.currency_code;
  const allowances = parseAllowances(item.allowances_json);
  const loanDeductions = parseJsonArray<AppliedLoanDeduction>(item.loan_deductions_json);
  const payeSlices = parseJsonArray<PayeBandSlice>(item.paye_breakdown_json);
  const adjTotal = adjustments.reduce((s, a) => s + a.delta_net_pesewas, 0);
  const finalNet = item.net_pay_pesewas + adjTotal;

  const pdf = new FormalPdf(org, {
    title: 'MONTHLY PAYSLIP',
    subtitle: `${item.staff_name} — ${item.role_title}`,
    period: `Pay period: ${item.pay_month}  ·  Shop: ${item.location_name || 'Main Shop'}`,
    documentLabel: 'CONFIDENTIAL PAYSLIP',
    notes: [
      'SSNIT employee share (5.5% default) is deducted before calculating PAYE income tax.',
      'Employer SSNIT contribution is paid by the shop on your behalf and is not deducted from your net pay.',
      'Please verify statutory rates with your accountant if GRA or SSNIT updates thresholds.',
    ],
  });

  pdf.section('Staff & payment details');
  pdf.kvTable([
    { label: 'Staff name', value: item.staff_name },
    { label: 'Role', value: item.role_title },
    { label: 'Shop / branch', value: item.location_name || 'Main Shop' },
    { label: 'Pay type', value: item.pay_type.replace('_', ' ') },
    { label: 'Days / shifts worked', value: `${item.days_worked} days (${(item.worked_minutes / 60).toFixed(1)} hrs)` },
    { label: 'Payment method', value: `${item.payment_method.toUpperCase()} — ${item.payment_destination}` },
    { label: 'Payment status', value: item.payment_status === 'paid' ? `Paid${item.payment_reference ? ` (${item.payment_reference})` : ''}` : 'Pending payment' },
  ]);

  pdf.section('Earnings (before deductions)');
  const earningsRows = [
    { label: 'Basic pay', value: pdfMoney(item.basic_pay_pesewas, cc) },
    ...(item.absence_deduction_pesewas > 0
      ? [{ label: `Unpaid absence (${item.absent_days} day${item.absent_days === 1 ? '' : 's'})`, value: `-${pdfMoney(item.absence_deduction_pesewas, cc)}` }]
      : []),
    ...allowances.map((a) => ({
      label: `Allowance: ${a.name}${a.is_taxable ? '' : ' (non-taxable)'}`,
      value: pdfMoney(a.amount_pesewas, cc),
    })),
    ...(item.overtime_pay_pesewas > 0
      ? [{ label: `Overtime (${(item.overtime_minutes / 60).toFixed(1)} hrs)`, value: pdfMoney(item.overtime_pay_pesewas, cc) }]
      : []),
    ...(item.commission_pesewas > 0
      ? [{ label: `Sales commission (POS sales ${pdfMoney(item.sales_total_pesewas, cc)})`, value: pdfMoney(item.commission_pesewas, cc) }]
      : []),
    ...(item.bonus_pesewas > 0
      ? [{ label: 'Bonus', value: pdfMoney(item.bonus_pesewas, cc) }]
      : []),
    { label: 'Gross pay (total earned)', value: pdfMoney(item.gross_pay_pesewas, cc), emphasis: 'subtotal' as const },
  ];
  pdf.kvTable(earningsRows);

  pdf.section('Deductions');
  const deductionRows = [
    { label: 'SSNIT (employee pension share)', value: pdfMoney(item.ssnit_employee_pesewas, cc) },
    { label: `PAYE income tax (on taxable ${pdfMoney(item.chargeable_income_pesewas, cc)})`, value: pdfMoney(item.paye_pesewas, cc) },
    ...loanDeductions.map((d) => ({
      label: `${d.kind.charAt(0).toUpperCase() + d.kind.slice(1)}: ${d.reason} (Bal: ${pdfMoney(d.remaining_after_pesewas, cc)})`,
      value: pdfMoney(d.applied_pesewas, cc),
    })),
    { label: 'Total deductions', value: pdfMoney(item.total_deductions_pesewas, cc), emphasis: 'subtotal' as const },
    { label: 'Take-home pay (Net pay)', value: pdfMoney(item.net_pay_pesewas, cc), emphasis: 'total' as const },
  ];
  pdf.kvTable(deductionRows);

  if (adjustments.length > 0) {
    pdf.section('Post-lock logged adjustments');
    pdf.dataTable(
      ['Date', 'Type', 'Reason', 'Amount'],
      adjustments.map((adj) => [
        adj.created_at.slice(0, 10),
        adj.adjustment_type,
        adj.reason,
        `${adj.delta_net_pesewas >= 0 ? '+' : ''}${pdfMoney(adj.delta_net_pesewas, cc)}`,
      ]),
      [1.2, 1.2, 3, 1.4]
    );
    pdf.kvTable([
      { label: 'Adjusted take-home pay', value: pdfMoney(finalNet, cc), emphasis: 'total' },
    ]);
  }

  if (payeSlices.length > 0 && item.paye_pesewas > 0) {
    pdf.section('PAYE tax band breakdown');
    pdf.dataTable(
      ['Band', 'Rate', 'Income in band', 'Tax'],
      payeSlices.map((s) => [
        s.label,
        `${(s.rate_bps / 100).toFixed(1)}%`,
        pdfMoney(s.taxable_pesewas, cc),
        pdfMoney(s.tax_pesewas, cc),
      ]),
      [2.6, 0.9, 1.4, 1.2]
    );
  }

  pdf.section('Employer pension contribution (for your records)');
  pdf.kvTable([
    { label: 'Employer SSNIT contribution (paid by shop)', value: pdfMoney(item.ssnit_employer_pesewas, cc), emphasis: 'muted' },
  ]);

  pdf.signatureBlock('Employer / Owner', 'Staff member');
  const safeName = item.staff_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  pdf.save(`payslip-${item.pay_month}-${safeName || 'staff'}.pdf`);
}

export function buildPayslipWhatsAppText(
  storeName: string,
  item: LocalPayrollRunItem,
  adjustments: LocalPayrollAdjustment[] = []
): string {
  const allowances = parseAllowances(item.allowances_json);
  const loanDeductions = parseJsonArray<AppliedLoanDeduction>(item.loan_deductions_json);
  const adjTotal = adjustments.reduce((s, a) => s + a.delta_net_pesewas, 0);
  const finalNet = item.net_pay_pesewas + adjTotal;

  const lines = [
    `*${storeName} — Payslip (${item.pay_month})*`,
    `Staff: ${item.staff_name} (${item.role_title})`,
    `Shop: ${item.location_name || 'Main Shop'}`,
    '',
    '*Earnings*',
    `• Basic pay: ${formatPesewas(item.basic_pay_pesewas)}`,
    ...(item.absence_deduction_pesewas > 0
      ? [`• Absence deduction: -${formatPesewas(item.absence_deduction_pesewas)}`]
      : []),
    ...allowances.map((a) => `• ${a.name}: ${formatPesewas(a.amount_pesewas)}`),
    ...(item.overtime_pay_pesewas > 0 ? [`• Overtime: ${formatPesewas(item.overtime_pay_pesewas)}`] : []),
    ...(item.commission_pesewas > 0 ? [`• Sales commission: ${formatPesewas(item.commission_pesewas)}`] : []),
    ...(item.bonus_pesewas > 0 ? [`• Bonus: ${formatPesewas(item.bonus_pesewas)}`] : []),
    `*Gross pay: ${formatPesewas(item.gross_pay_pesewas)}*`,
    '',
    '*Deductions*',
    `• SSNIT (employee): ${formatPesewas(item.ssnit_employee_pesewas)}`,
    `• PAYE income tax: ${formatPesewas(item.paye_pesewas)}`,
    ...loanDeductions.map((d) => `• ${d.reason}: ${formatPesewas(d.applied_pesewas)} (Bal: ${formatPesewas(d.remaining_after_pesewas)})`),
    ...(adjTotal !== 0 ? [`• Logged adjustments: ${adjTotal > 0 ? '+' : ''}${formatPesewas(adjTotal)}`] : []),
    '',
    `*Take-home pay (Net): ${formatPesewas(finalNet)}*`,
    `Payment: ${item.payment_method.toUpperCase()} (${item.payment_destination})`,
    `Status: ${item.payment_status === 'paid' ? 'Paid' : 'Pending'}`,
  ];

  return lines.join('\n');
}

export function sharePayslipViaWhatsApp(phone: string, text: string): void {
  const parsed = parseGhanaPhone(phone);
  const target = parsed ? `https://wa.me/${parsed.e164.replace('+', '')}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(target, '_blank', 'noopener,noreferrer');
}

export function printPayslip(
  storeName: string,
  item: LocalPayrollRunItem,
  adjustments: LocalPayrollAdjustment[] = []
): void {
  const allowances = parseAllowances(item.allowances_json);
  const loanDeductions = parseJsonArray<AppliedLoanDeduction>(item.loan_deductions_json);
  const adjTotal = adjustments.reduce((s, a) => s + a.delta_net_pesewas, 0);
  const finalNet = item.net_pay_pesewas + adjTotal;

  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Payslip - ${esc(item.staff_name)} - ${esc(item.pay_month)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; margin: 24px; max-width: 680px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #065f46; }
  .sub { color: #475569; font-size: 13px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
  td:last-child, th:last-child { text-align: right; }
  .total td { font-weight: 700; background: #ecfdf5; border-top: 2px solid #065f46; }
  .section { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin: 14px 0 6px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${esc(storeName)} — Monthly Payslip</h1>
  <div class="sub">${esc(item.staff_name)} (${esc(item.role_title)}) · ${esc(item.pay_month)} · ${esc(item.location_name || 'Main Shop')}</div>
  <div class="section">Earnings</div>
  <table>
    <tr><td>Basic pay</td><td>${esc(formatPesewas(item.basic_pay_pesewas))}</td></tr>
    ${item.absence_deduction_pesewas > 0 ? `<tr><td>Absence deduction (${item.absent_days}d)</td><td>-${esc(formatPesewas(item.absence_deduction_pesewas))}</td></tr>` : ''}
    ${allowances.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(formatPesewas(a.amount_pesewas))}</td></tr>`).join('')}
    ${item.overtime_pay_pesewas > 0 ? `<tr><td>Overtime (${(item.overtime_minutes / 60).toFixed(1)} hrs)</td><td>${esc(formatPesewas(item.overtime_pay_pesewas))}</td></tr>` : ''}
    ${item.commission_pesewas > 0 ? `<tr><td>Sales commission</td><td>${esc(formatPesewas(item.commission_pesewas))}</td></tr>` : ''}
    ${item.bonus_pesewas > 0 ? `<tr><td>Bonus</td><td>${esc(formatPesewas(item.bonus_pesewas))}</td></tr>` : ''}
    <tr class="total"><td>Gross pay</td><td>${esc(formatPesewas(item.gross_pay_pesewas))}</td></tr>
  </table>
  <div class="section">Deductions</div>
  <table>
    <tr><td>SSNIT (employee)</td><td>${esc(formatPesewas(item.ssnit_employee_pesewas))}</td></tr>
    <tr><td>PAYE income tax</td><td>${esc(formatPesewas(item.paye_pesewas))}</td></tr>
    ${loanDeductions.map((d) => `<tr><td>${esc(d.reason)} (Bal: ${esc(formatPesewas(d.remaining_after_pesewas))})</td><td>${esc(formatPesewas(d.applied_pesewas))}</td></tr>`).join('')}
    ${adjustments.map((a) => `<tr><td>Adjustment: ${esc(a.reason)}</td><td>${a.delta_net_pesewas >= 0 ? '+' : ''}${esc(formatPesewas(a.delta_net_pesewas))}</td></tr>`).join('')}
    <tr class="total"><td>Take-home pay (Net pay)</td><td>${esc(formatPesewas(finalNet))}</td></tr>
  </table>
  <div class="sub">Payment: ${esc(item.payment_method.toUpperCase())} — ${esc(item.payment_destination)} · Employer SSNIT paid by shop: ${esc(formatPesewas(item.ssnit_employer_pesewas))}</div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=760,height=860');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function exportComplianceSummaryPdf(
  store: LocalStore | null | undefined,
  summary: MonthlyComplianceSummary
): void {
  const org = orgFromStore(store);
  const cc = store?.currency_code;

  const pdf = new FormalPdf(org, {
    title: 'MONTHLY PAYE & SSNIT FILING SUMMARY',
    subtitle: `Pay period: ${summary.payMonth}  ·  Filing due by ${summary.dueDate}`,
    documentLabel: 'STATUTORY FILING SUMMARY',
    notes: [
      `GRA PAYE and SSNIT returns for ${summary.payMonth} are due on or before ${summary.dueDate} (15th of the following month).`,
      summary.taxVerified
        ? 'Statutory tax bands and SSNIT rates were marked verified with your accountant.'
        : 'REMINDER: Verify tax bands, SSNIT rates, and SSNIT earnings cap with your accountant before submitting to GRA/SSNIT.',
    ],
  });

  pdf.section('Statutory remittance totals');
  pdf.kvTable([
    { label: 'Staff paid', value: String(summary.staffCount) },
    { label: 'Total gross pay', value: pdfMoney(summary.totalGrossPesewas, cc) },
    { label: 'SSNIT employee share', value: pdfMoney(summary.totalSsnitEmployeePesewas, cc) },
    { label: 'SSNIT employer share', value: pdfMoney(summary.totalSsnitEmployerPesewas, cc) },
    { label: 'Total SSNIT to remit (employee + employer)', value: pdfMoney(summary.totalSsnitRemittancePesewas, cc), emphasis: 'subtotal' },
    { label: 'Total PAYE income tax to remit to GRA', value: pdfMoney(summary.totalPayeRemittancePesewas, cc), emphasis: 'subtotal' },
    { label: 'Total employer payroll cost (gross + employer SSNIT)', value: pdfMoney(summary.totalEmployerCostPesewas, cc), emphasis: 'total' },
  ]);

  pdf.section('Staff schedule');
  pdf.dataTable(
    ['Staff', 'SSNIT / TIN', 'Gross', 'SSNIT (Emp/Er)', 'PAYE', 'Net Pay'],
    summary.staffLines.map((line) => [
      line.staffName,
      [line.ssnitNumber, line.tinNumber].filter(Boolean).join(' / ') || '—',
      pdfMoney(line.grossPesewas, cc),
      `${pdfMoney(line.ssnitEmployeePesewas, cc)} / ${pdfMoney(line.ssnitEmployerPesewas, cc)}`,
      pdfMoney(line.payePesewas, cc),
      pdfMoney(line.netPayPesewas, cc),
    ]),
    [1.8, 1.5, 1.1, 1.7, 1.0, 1.1]
  );

  pdf.signatureBlock('Prepared by', 'Approved by Owner');
  pdf.save(`statutory-paye-ssnit-${summary.payMonth}.pdf`);
}

export function exportYearEndReportPdf(
  store: LocalStore | null | undefined,
  year: number,
  rows: YearEndStaffRow[]
): void {
  const org = orgFromStore(store);
  const cc = store?.currency_code;

  const pdf = new FormalPdf(org, {
    title: `YEAR-END PAYROLL SUMMARY (${year})`,
    subtitle: `Annual staff earnings, SSNIT, PAYE, and deductions for ${year}`,
    documentLabel: 'ANNUAL PAYROLL REPORT',
    notes: [
      'Includes approved and locked monthly pay runs plus logged post-lock adjustments.',
      'Share with your accountant for annual GRA employer returns.',
    ],
  });

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.totalGrossPesewas,
      ssnitEmp: acc.ssnitEmp + r.totalSsnitEmployeePesewas,
      ssnitEr: acc.ssnitEr + r.totalSsnitEmployerPesewas,
      paye: acc.paye + r.totalPayePesewas,
      other: acc.other + r.totalOtherDeductionsPesewas,
      net: acc.net + r.totalNetPesewas,
      employerCost: acc.employerCost + r.totalEmployerCostPesewas,
    }),
    { gross: 0, ssnitEmp: 0, ssnitEr: 0, paye: 0, other: 0, net: 0, employerCost: 0 }
  );

  pdf.section('Annual totals');
  pdf.kvTable([
    { label: 'Total gross earnings', value: pdfMoney(totals.gross, cc) },
    { label: 'Total SSNIT (employee)', value: pdfMoney(totals.ssnitEmp, cc) },
    { label: 'Total SSNIT (employer)', value: pdfMoney(totals.ssnitEr, cc) },
    { label: 'Total PAYE deducted', value: pdfMoney(totals.paye, cc) },
    { label: 'Total loans / advances / fines deducted', value: pdfMoney(totals.other, cc) },
    { label: 'Total net paid to staff', value: pdfMoney(totals.net, cc), emphasis: 'subtotal' },
    { label: 'Total employer payroll cost', value: pdfMoney(totals.employerCost, cc), emphasis: 'total' },
  ]);

  pdf.section('Per-staff breakdown');
  pdf.dataTable(
    ['Staff', 'Mos', 'Gross', 'SSNIT Emp', 'PAYE', 'Other Ded.', 'Net Paid'],
    rows.map((r) => [
      r.staffName,
      String(r.monthsPaid),
      pdfMoney(r.totalGrossPesewas, cc),
      pdfMoney(r.totalSsnitEmployeePesewas, cc),
      pdfMoney(r.totalPayePesewas, cc),
      pdfMoney(r.totalOtherDeductionsPesewas, cc),
      pdfMoney(r.totalNetPesewas, cc),
    ]),
    [2.0, 0.5, 1.2, 1.1, 1.1, 1.1, 1.2]
  );

  pdf.signatureBlock('Prepared by', 'Store Owner');
  pdf.save(`payroll-year-end-${year}.pdf`);
}

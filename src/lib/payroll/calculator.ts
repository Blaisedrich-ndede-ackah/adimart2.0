import type {
  AppliedLoanDeduction,
  LocalPayrollDeduction,
  LocalPayrollTaxConfig,
  PayeBandSlice,
  PayeTaxBand,
  PayrollAllowanceItem,
  PayrollPayType,
  PayrollRulesInput,
  PayrollTaxConfigInput,
} from './types.ts';

/**
 * Pure integer-pesewa payroll calculation engine.
 * Every monetary figure is an integer number of pesewas (1 GHS = 100 pesewas).
 * Zero rates or tax bands are hard-coded here — all statutory settings are
 * injected via PayrollTaxConfigInput.
 */

export function ghsToPesewas(ghs: number | string): number {
  const parsed = typeof ghs === 'number' ? ghs : Number(String(ghs).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function pesewasToGhs(pesewas: number): number {
  if (!Number.isFinite(pesewas)) return 0;
  return Math.round(pesewas) / 100;
}

export function formatPesewas(pesewas: number, symbol = 'GH₵'): string {
  const safe = Number.isFinite(pesewas) ? Math.round(pesewas) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const formatted = `${whole.toLocaleString('en-GH')}.${frac}`;
  const spaced = /[A-Za-z]/.test(symbol) ? `${symbol} ${formatted}` : `${symbol}${formatted}`;
  return negative ? `-${spaced}` : spaced;
}

/**
 * Exact half-up integer multiplication by basis points (10,000 bps = 100%).
 * Uses BigInt internally to prevent IEEE-754 floating-point drift.
 */
export function applyBps(amountPesewas: number, rateBps: number): number {
  const amount = Math.round(amountPesewas);
  const rate = Math.round(rateBps);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0 || rate <= 0) return 0;
  const result = (BigInt(amount) * BigInt(rate) + 5_000n) / 10_000n;
  return Number(result);
}

/**
 * Exact half-up rational scaling: round((amount * numerator) / denominator).
 */
export function scalePesewas(amountPesewas: number, numerator: number, denominator: number): number {
  const amount = Math.round(amountPesewas);
  const num = Math.round(numerator);
  const den = Math.round(denominator);
  if (!Number.isFinite(amount) || !Number.isFinite(num) || !Number.isFinite(den)) return 0;
  if (amount <= 0 || num <= 0 || den <= 0) return 0;
  const bigNum = BigInt(amount) * BigInt(num);
  const bigDen = BigInt(den);
  return Number((bigNum + bigDen / 2n) / bigDen);
}

/**
 * Pick the active statutory tax config whose effective_from <= asOfDate (YYYY-MM-DD),
 * preferring the most recent effective_from date. Falls back to the earliest config
 * if all configs start after asOfDate.
 */
export function selectEffectiveTaxConfig<T extends Pick<LocalPayrollTaxConfig, 'effective_from' | 'is_active'>>(
  configs: T[],
  asOfDate: string
): T | null {
  const active = configs.filter((c) => c.is_active === 1);
  const pool = active.length > 0 ? active : configs;
  if (pool.length === 0) return null;

  const eligible = pool
    .filter((c) => c.effective_from <= asOfDate)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  if (eligible.length > 0) return eligible[0];

  return [...pool].sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
}

export interface SsnitResult {
  pensionable_pesewas: number;
  employee_pesewas: number;
  employer_pesewas: number;
  capped: boolean;
}

/**
 * Compute SSNIT employee & employer contributions with optional monthly earnings cap
 * and floor, strictly from the supplied editable tax config.
 */
export function calculateSsnit(params: {
  basicPayPesewas: number;
  grossCashPesewas: number;
  ssnitExempt: boolean;
  taxConfig: PayrollTaxConfigInput;
}): SsnitResult {
  const { basicPayPesewas, grossCashPesewas, ssnitExempt, taxConfig } = params;
  if (ssnitExempt) {
    return {
      pensionable_pesewas: 0,
      employee_pesewas: 0,
      employer_pesewas: 0,
      capped: false,
    };
  }

  const rawBasis = Math.max(
    0,
    Math.round(taxConfig.ssnit_basis === 'gross_cash' ? grossCashPesewas : basicPayPesewas)
  );
  if (rawBasis === 0) {
    return {
      pensionable_pesewas: 0,
      employee_pesewas: 0,
      employer_pesewas: 0,
      capped: false,
    };
  }

  let pensionable = rawBasis;
  if (taxConfig.ssnit_min_insurable_pesewas > 0 && pensionable < taxConfig.ssnit_min_insurable_pesewas) {
    pensionable = Math.round(taxConfig.ssnit_min_insurable_pesewas);
  }

  let capped = false;
  if (taxConfig.ssnit_max_insurable_pesewas > 0 && pensionable > taxConfig.ssnit_max_insurable_pesewas) {
    pensionable = Math.round(taxConfig.ssnit_max_insurable_pesewas);
    capped = true;
  }

  return {
    pensionable_pesewas: pensionable,
    employee_pesewas: applyBps(pensionable, taxConfig.ssnit_employee_rate_bps),
    employer_pesewas: applyBps(pensionable, taxConfig.ssnit_employer_rate_bps),
    capped,
  };
}

export interface PayeResult {
  chargeable_income_pesewas: number;
  tax_pesewas: number;
  slices: PayeBandSlice[];
}

/**
 * Normalize tax bands so the editable tax_free_threshold_pesewas always governs
 * the initial 0% slice if band 0 is a 0% band, or prepends a 0% threshold band
 * when bands start with a positive tax rate.
 */
export function resolveEffectivePayeBands(taxConfig: PayrollTaxConfigInput): PayeTaxBand[] {
  const rawBands = taxConfig.paye_bands.length > 0 ? taxConfig.paye_bands : [];
  const threshold = Math.max(0, Math.round(taxConfig.tax_free_threshold_pesewas || 0));

  if (rawBands.length === 0) {
    return [{ label: 'Tax-free threshold', width_pesewas: null, rate_bps: 0 }];
  }

  if (rawBands[0].rate_bps === 0) {
    return [
      {
        ...rawBands[0],
        width_pesewas: threshold > 0 ? threshold : rawBands[0].width_pesewas,
      },
      ...rawBands.slice(1),
    ];
  }

  if (threshold > 0) {
    return [
      { label: 'Tax-free threshold', width_pesewas: threshold, rate_bps: 0 },
      ...rawBands,
    ];
  }

  return rawBands;
}

/**
 * Progressive PAYE calculation across editable bands.
 * All intermediate slices and total tax are exact integer pesewas.
 */
export function calculatePaye(
  chargeableIncomePesewas: number,
  taxConfig: PayrollTaxConfigInput
): PayeResult {
  const chargeable = Math.max(0, Math.round(chargeableIncomePesewas));
  const bands = resolveEffectivePayeBands(taxConfig);

  let remaining = chargeable;
  let totalTax = 0;
  const slices: PayeBandSlice[] = [];

  for (const band of bands) {
    if (remaining <= 0) break;
    const width = band.width_pesewas === null ? remaining : Math.max(0, Math.round(band.width_pesewas));
    if (band.width_pesewas !== null && width === 0) continue;

    const sliceAmount = band.width_pesewas === null ? remaining : Math.min(remaining, width);
    const sliceTax = applyBps(sliceAmount, band.rate_bps);

    slices.push({
      label: band.label,
      rate_bps: band.rate_bps,
      taxable_pesewas: sliceAmount,
      tax_pesewas: sliceTax,
    });

    totalTax += sliceTax;
    remaining -= sliceAmount;
  }

  return {
    chargeable_income_pesewas: chargeable,
    tax_pesewas: totalTax,
    slices,
  };
}

/**
 * Calculate base pay for the pay period based on pay_type and attendance/worked units.
 */
export function calculatePeriodBasePay(params: {
  payType: PayrollPayType;
  ratePesewas: number;
  daysWorked: number;
  shiftsWorked: number;
  workingDaysPerMonth: number;
}): number {
  const rate = Math.max(0, Math.round(params.ratePesewas));
  const daysPerMonth = Math.max(1, Math.round(params.workingDaysPerMonth || 26));
  const daysPerWeek = daysPerMonth <= 22 ? 5 : 6;

  switch (params.payType) {
    case 'monthly':
      return rate;
    case 'weekly': {
      // Half-day granularity supported via multiplying by 2
      const halfDays = Math.max(0, Math.round((params.daysWorked || 0) * 2));
      return scalePesewas(rate, halfDays, daysPerWeek * 2);
    }
    case 'daily': {
      const halfDays = Math.max(0, Math.round((params.daysWorked || 0) * 2));
      return scalePesewas(rate, halfDays, 2);
    }
    case 'per_shift': {
      const halfShifts = Math.max(0, Math.round((params.shiftsWorked || 0) * 2));
      return scalePesewas(rate, halfShifts, 2);
    }
  }
}

/**
 * Calculate overtime pay from overtime minutes and the store's overtime rule.
 */
export function calculateOvertimePay(params: {
  payType: PayrollPayType;
  ratePesewas: number;
  overtimeMinutes: number;
  rules: PayrollRulesInput;
}): number {
  const rate = Math.max(0, Math.round(params.ratePesewas));
  const otMinutes = Math.max(0, Math.round(params.overtimeMinutes));
  const multiplierBps = Math.max(0, Math.round(params.rules.overtime_multiplier_bps));
  if (rate <= 0 || otMinutes <= 0 || multiplierBps <= 0) return 0;

  const hoursPerDay = Math.max(1, params.rules.standard_hours_per_day || 8);
  const daysPerMonth = Math.max(1, Math.round(params.rules.working_days_per_month || 26));
  const daysPerWeek = daysPerMonth <= 22 ? 5 : 6;

  let periodMinutes: number;
  switch (params.payType) {
    case 'monthly':
      periodMinutes = Math.round(daysPerMonth * hoursPerDay * 60);
      break;
    case 'weekly':
      periodMinutes = Math.round(daysPerWeek * hoursPerDay * 60);
      break;
    case 'daily':
    case 'per_shift':
      periodMinutes = Math.round(hoursPerDay * 60);
      break;
  }

  if (periodMinutes <= 0) return 0;

  // Exact BigInt: roundHalfUp((rate * otMinutes * multiplierBps) / (periodMinutes * 10000))
  const numerator = BigInt(rate) * BigInt(otMinutes) * BigInt(multiplierBps);
  const denominator = BigInt(periodMinutes) * 10_000n;
  return Number((numerator + denominator / 2n) / denominator);
}

/**
 * Calculate unpaid absence deduction for salaried/monthly staff.
 * For daily/per_shift/weekly staff, unworked days are already excluded from daysWorked.
 */
export function calculateAbsenceDeduction(params: {
  payType: PayrollPayType;
  basicPayForPeriodPesewas: number;
  absentDays: number;
  rules: PayrollRulesInput;
}): number {
  if (params.payType !== 'monthly') return 0;
  const absent = Math.max(0, params.absentDays);
  const basic = Math.max(0, Math.round(params.basicPayForPeriodPesewas));
  if (absent <= 0 || basic <= 0 || params.rules.absence_deduction_mode === 'none') return 0;

  const halfAbsent = Math.round(absent * 2);
  let deduction = 0;

  if (params.rules.absence_deduction_mode === 'daily_prorata') {
    const daysPerMonth = Math.max(1, Math.round(params.rules.working_days_per_month || 26));
    deduction = scalePesewas(basic, halfAbsent, daysPerMonth * 2);
  } else if (params.rules.absence_deduction_mode === 'fixed_pesewas') {
    const perDay = Math.max(0, Math.round(params.rules.absence_fixed_deduction_pesewas || 0));
    deduction = scalePesewas(perDay, halfAbsent, 2);
  }

  return Math.min(basic, deduction);
}

/**
 * Calculate cashier sales commission from POS sales total in pesewas.
 */
export function calculateSalesCommission(params: {
  commissionEnabled: boolean;
  commissionRateBps: number;
  commissionMinSalesPesewas: number;
  salesTotalPesewas: number;
}): number {
  if (!params.commissionEnabled) return 0;
  const sales = Math.max(0, Math.round(params.salesTotalPesewas));
  const minSales = Math.max(0, Math.round(params.commissionMinSalesPesewas));
  if (sales < minSales || sales === 0) return 0;
  return applyBps(sales, params.commissionRateBps);
}

export interface PayslipCalculationInput {
  payType: PayrollPayType;
  basicRatePesewas: number;
  allowances: PayrollAllowanceItem[];
  daysWorked: number;
  shiftsWorked: number;
  overtimeMinutes: number;
  absentDays: number;
  ssnitExempt: boolean;
  commissionEnabled: boolean;
  commissionRateBps: number;
  commissionMinSalesPesewas: number;
  salesTotalPesewas: number;
  bonusPesewas: number;
  activeDeductions: Pick<
    LocalPayrollDeduction,
    'id' | 'kind' | 'reason' | 'monthly_repayment_pesewas' | 'remaining_balance_pesewas' | 'start_month' | 'status'
  >[];
  payMonth: string;
  taxConfig: PayrollTaxConfigInput;
  rules: PayrollRulesInput;
}

export interface PayslipCalculationResult {
  basic_pay_pesewas: number;
  absence_deduction_pesewas: number;
  effective_basic_pesewas: number;
  total_allowances_pesewas: number;
  taxable_allowances_pesewas: number;
  non_taxable_allowances_pesewas: number;
  overtime_pay_pesewas: number;
  commission_pesewas: number;
  bonus_pesewas: number;
  gross_pay_pesewas: number;
  ssnit: SsnitResult;
  paye: PayeResult;
  applied_deductions: AppliedLoanDeduction[];
  total_other_deductions_pesewas: number;
  total_deductions_pesewas: number;
  net_pay_pesewas: number;
  employer_cost_pesewas: number;
}

/**
 * End-to-end calculation of a single staff member's payslip for a pay period.
 *
 * Order of operations (standard Ghana payroll flow):
 * 1. Base pay for period (monthly / weekly / daily / per shift) minus unpaid absence deduction
 * 2. Allowances (separated into taxable and non-taxable)
 * 3. Overtime pay + POS sales commission + manual bonus
 * 4. Gross Pay = effective basic + allowances + overtime + commission + bonus
 * 5. SSNIT (employee & employer) on capped pensionable earnings (basic_only by default)
 * 6. Chargeable Income = max(0, taxable gross - employee SSNIT)
 * 7. Progressive PAYE across editable bands
 * 8. Loans, advances, and fines (capped so net pay never drops below 0)
 * 9. Net Pay = Gross - Employee SSNIT - PAYE - Other Deductions
 * 10. Total Employer Cost = Gross + Employer SSNIT
 */
export function calculatePayslip(input: PayslipCalculationInput): PayslipCalculationResult {
  const basicPay = calculatePeriodBasePay({
    payType: input.payType,
    ratePesewas: input.basicRatePesewas,
    daysWorked: input.daysWorked,
    shiftsWorked: input.shiftsWorked,
    workingDaysPerMonth: input.rules.working_days_per_month,
  });

  const absenceDeduction = calculateAbsenceDeduction({
    payType: input.payType,
    basicPayForPeriodPesewas: basicPay,
    absentDays: input.absentDays,
    rules: input.rules,
  });

  const effectiveBasic = Math.max(0, basicPay - absenceDeduction);

  let taxableAllowances = 0;
  let nonTaxableAllowances = 0;
  for (const item of input.allowances) {
    const amt = Math.max(0, Math.round(item.amount_pesewas || 0));
    if (item.is_taxable) taxableAllowances += amt;
    else nonTaxableAllowances += amt;
  }
  const totalAllowances = taxableAllowances + nonTaxableAllowances;

  const overtimePay = calculateOvertimePay({
    payType: input.payType,
    ratePesewas: input.basicRatePesewas,
    overtimeMinutes: input.overtimeMinutes,
    rules: input.rules,
  });

  const commission = calculateSalesCommission({
    commissionEnabled: input.commissionEnabled,
    commissionRateBps: input.commissionRateBps,
    commissionMinSalesPesewas: input.commissionMinSalesPesewas,
    salesTotalPesewas: input.salesTotalPesewas,
  });

  const bonus = Math.max(0, Math.round(input.bonusPesewas || 0));

  const grossPay = effectiveBasic + totalAllowances + overtimePay + commission + bonus;
  const taxableGross = effectiveBasic + taxableAllowances + overtimePay + commission + bonus;

  const ssnit = calculateSsnit({
    basicPayPesewas: effectiveBasic,
    grossCashPesewas: grossPay,
    ssnitExempt: input.ssnitExempt,
    taxConfig: input.taxConfig,
  });

  const chargeableIncome = Math.max(0, taxableGross - ssnit.employee_pesewas);
  const paye = calculatePaye(chargeableIncome, input.taxConfig);

  let availableForOtherDeductions = Math.max(0, grossPay - ssnit.employee_pesewas - paye.tax_pesewas);
  const appliedDeductions: AppliedLoanDeduction[] = [];
  let totalOtherDeductions = 0;

  for (const ded of input.activeDeductions) {
    if (ded.status !== 'active') continue;
    if (ded.remaining_balance_pesewas <= 0) continue;
    if (ded.start_month && ded.start_month > input.payMonth) continue;

    const scheduled = Math.min(
      Math.max(0, Math.round(ded.monthly_repayment_pesewas)),
      Math.max(0, Math.round(ded.remaining_balance_pesewas))
    );
    if (scheduled <= 0) continue;

    const applied = Math.min(scheduled, availableForOtherDeductions);
    availableForOtherDeductions -= applied;
    totalOtherDeductions += applied;

    appliedDeductions.push({
      deduction_id: ded.id,
      kind: ded.kind,
      reason: ded.reason,
      scheduled_pesewas: scheduled,
      applied_pesewas: applied,
      remaining_after_pesewas: Math.max(0, Math.round(ded.remaining_balance_pesewas) - applied),
    });
  }

  const totalDeductions = ssnit.employee_pesewas + paye.tax_pesewas + totalOtherDeductions;
  const netPay = Math.max(0, grossPay - totalDeductions);
  const employerCost = grossPay + ssnit.employer_pesewas;

  return {
    basic_pay_pesewas: basicPay,
    absence_deduction_pesewas: absenceDeduction,
    effective_basic_pesewas: effectiveBasic,
    total_allowances_pesewas: totalAllowances,
    taxable_allowances_pesewas: taxableAllowances,
    non_taxable_allowances_pesewas: nonTaxableAllowances,
    overtime_pay_pesewas: overtimePay,
    commission_pesewas: commission,
    bonus_pesewas: bonus,
    gross_pay_pesewas: grossPay,
    ssnit,
    paye,
    applied_deductions: appliedDeductions,
    total_other_deductions_pesewas: totalOtherDeductions,
    total_deductions_pesewas: totalDeductions,
    net_pay_pesewas: netPay,
    employer_cost_pesewas: employerCost,
  };
}

/**
 * Return the GRA PAYE / SSNIT statutory filing due date for a pay_month ("YYYY-MM"):
 * 15th (or configured filing_due_day) of the following month.
 */
export function getStatutoryFilingDueDate(payMonth: string, filingDueDay = 15): string {
  const match = /^(\d{4})-(\d{2})$/.exec(payMonth);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]); // 1..12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const day = Math.min(28, Math.max(1, Math.round(filingDueDay || 15)));
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getMonthPeriodBounds(payMonth: string): { periodStart: string; periodEnd: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(payMonth);
  if (!match) {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return getMonthPeriodBounds(fallback);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
    periodEnd: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBps,
  calculateAbsenceDeduction,
  calculateOvertimePay,
  calculatePaye,
  calculatePayslip,
  calculatePeriodBasePay,
  calculateSalesCommission,
  calculateSsnit,
  formatPesewas,
  getMonthPeriodBounds,
  getStatutoryFilingDueDate,
  ghsToPesewas,
  pesewasToGhs,
  selectEffectiveTaxConfig,
} from '../calculator.ts';
import { DEFAULT_GHANA_TAX_CONFIG_INPUT } from '../taxDefaults.ts';
import type { PayrollRulesInput, PayrollTaxConfigInput } from '../types.ts';

const DEFAULT_RULES: PayrollRulesInput = {
  standard_hours_per_day: 8,
  working_days_per_month: 26,
  overtime_multiplier_bps: 15_000, // 1.5x
  absence_deduction_mode: 'daily_prorata',
  absence_fixed_deduction_pesewas: 0,
};

describe('Integer pesewa money helpers', () => {
  it('converts between GHS and integer pesewas without floating point drift', () => {
    assert.equal(ghsToPesewas(19.99), 1999);
    assert.equal(ghsToPesewas('1,234.56'), 123_456);
    assert.equal(pesewasToGhs(123_456), 1234.56);
    assert.equal(formatPesewas(123_456), 'GH₵ 1,234.56');
    assert.equal(formatPesewas(-500), '-GH₵ 5.00');
  });

  it('applies basis points with deterministic half-up rounding', () => {
    assert.equal(applyBps(100_000, 550), 5_500); // 5.5% of GH₵ 1,000 = GH₵ 55
    assert.equal(applyBps(100, 1_750), 18); // 17.5 pesewas -> 18 pesewas
    assert.equal(applyBps(100, 1_749), 17); // 17.49 pesewas -> 17 pesewas
    assert.equal(applyBps(0, 550), 0);
    assert.equal(applyBps(-100, 550), 0);
  });
});

describe('Ghana PAYE graduated tax calculation & band boundaries', () => {
  const config = DEFAULT_GHANA_TAX_CONFIG_INPUT;

  it('charges zero tax at and below the tax-free threshold (GH₵ 490.00)', () => {
    assert.equal(calculatePaye(0, config).tax_pesewas, 0);
    assert.equal(calculatePaye(48_999, config).tax_pesewas, 0);
    assert.equal(calculatePaye(49_000, config).tax_pesewas, 0);
  });

  it('calculates exact PAYE just above tax-free threshold and across every band boundary', () => {
    // GH₵ 491.00 = GH₵ 490 free + GH₵ 1.00 @ 5% = 5 pesewas
    assert.equal(calculatePaye(49_100, config).tax_pesewas, 5);

    // Band 2 upper boundary: 49,000 + 11,000 = 60,000 (GH₵ 600.00) -> 550 p (GH₵ 5.50)
    const b2 = calculatePaye(60_000, config);
    assert.equal(b2.tax_pesewas, 550);
    assert.equal(b2.slices.length, 2);

    // Band 3 upper boundary: 60,000 + 13,000 = 73,000 (GH₵ 730.00) -> 550 + 1,300 = 1,850 p
    const b3 = calculatePaye(73_000, config);
    assert.equal(b3.tax_pesewas, 1_850);
    assert.equal(b3.slices.length, 3);

    // Band 4 upper boundary: 73,000 + 316,667 = 389,667 (GH₵ 3,896.67) -> 1,850 + 55,417 = 57,267 p
    const b4 = calculatePaye(389_667, config);
    assert.equal(b4.tax_pesewas, 57_267);
    assert.equal(b4.slices.length, 4);

    // Band 5 upper boundary: 389,667 + 1,600,000 = 1,989,667 (GH₵ 19,896.67) -> 57,267 + 400,000 = 457,267 p
    const b5 = calculatePaye(1_989_667, config);
    assert.equal(b5.tax_pesewas, 457_267);
    assert.equal(b5.slices.length, 5);

    // Band 6 upper boundary: 1,989,667 + 3,052,000 = 5,041,667 (GH₵ 50,416.67) -> 457,267 + 915,600 = 1,372,867 p
    const b6 = calculatePaye(5_041_667, config);
    assert.equal(b6.tax_pesewas, 1_372_867);
    assert.equal(b6.slices.length, 6);

    // Top 35% band: +GH₵ 10,000.00 above Band 6 -> 1,372,867 + 350,000 = 1,722,867 p
    const b7 = calculatePaye(6_041_667, config);
    assert.equal(b7.tax_pesewas, 1_722_867);
    assert.equal(b7.slices.length, 7);
    assert.equal(b7.slices[6].rate_bps, 3_500);
    assert.equal(b7.slices[6].taxable_pesewas, 1_000_000);
    assert.equal(b7.slices[6].tax_pesewas, 350_000);
  });

  it('respects edited tax-free threshold and custom tax bands (no hard-coded rates)', () => {
    const customConfig: PayrollTaxConfigInput = {
      ...config,
      tax_free_threshold_pesewas: 100_000, // GH₵ 1,000 tax-free
      paye_bands: [
        { label: 'Free', width_pesewas: 100_000, rate_bps: 0 },
        { label: 'Flat 20%', width_pesewas: null, rate_bps: 2_000 },
      ],
    };

    assert.equal(calculatePaye(100_000, customConfig).tax_pesewas, 0);
    assert.equal(calculatePaye(200_000, customConfig).tax_pesewas, 20_000);
  });
});

describe('SSNIT employee & employer calculation with earnings cap', () => {
  const config = DEFAULT_GHANA_TAX_CONFIG_INPUT; // 5.5% emp, 13.0% er, cap GH₵ 52,000

  it('calculates 5.5% employee and 13% employer on basic salary below cap', () => {
    const res = calculateSsnit({
      basicPayPesewas: 200_000, // GH₵ 2,000
      grossCashPesewas: 250_000, // GH₵ 2,500 (includes GH₵ 500 allowance)
      ssnitExempt: false,
      taxConfig: config,
    });
    assert.equal(res.pensionable_pesewas, 200_000);
    assert.equal(res.employee_pesewas, 11_000); // GH₵ 110.00
    assert.equal(res.employer_pesewas, 26_000); // GH₵ 260.00
    assert.equal(res.capped, false);
  });

  it('handles exact SSNIT earnings cap boundary without capping flag', () => {
    const res = calculateSsnit({
      basicPayPesewas: 5_200_000, // exactly GH₵ 52,000
      grossCashPesewas: 5_200_000,
      ssnitExempt: false,
      taxConfig: config,
    });
    assert.equal(res.pensionable_pesewas, 5_200_000);
    assert.equal(res.employee_pesewas, 286_000); // GH₵ 2,860.00
    assert.equal(res.employer_pesewas, 676_000); // GH₵ 6,760.00
    assert.equal(res.capped, false);
  });

  it('caps SSNIT contributions when basic salary exceeds the SSNIT earnings cap', () => {
    const res = calculateSsnit({
      basicPayPesewas: 8_000_000, // GH₵ 80,000 > GH₵ 52,000 cap
      grossCashPesewas: 9_000_000,
      ssnitExempt: false,
      taxConfig: config,
    });
    assert.equal(res.pensionable_pesewas, 5_200_000);
    assert.equal(res.employee_pesewas, 286_000); // capped at 5.5% of 52,000
    assert.equal(res.employer_pesewas, 676_000); // capped at 13.0% of 52,000
    assert.equal(res.capped, true);
  });

  it('allows uncapped SSNIT when cap setting is 0, and respects editable rates/basis', () => {
    const customConfig: PayrollTaxConfigInput = {
      ...config,
      ssnit_employee_rate_bps: 600,
      ssnit_employer_rate_bps: 1_400,
      ssnit_max_insurable_pesewas: 0,
      ssnit_basis: 'gross_cash',
    };
    const res = calculateSsnit({
      basicPayPesewas: 200_000,
      grossCashPesewas: 300_000,
      ssnitExempt: false,
      taxConfig: customConfig,
    });
    assert.equal(res.pensionable_pesewas, 300_000);
    assert.equal(res.employee_pesewas, 18_000);
    assert.equal(res.employer_pesewas, 42_000);
    assert.equal(res.capped, false);
  });

  it('returns zero SSNIT for exempt staff', () => {
    const res = calculateSsnit({
      basicPayPesewas: 300_000,
      grossCashPesewas: 300_000,
      ssnitExempt: true,
      taxConfig: config,
    });
    assert.equal(res.pensionable_pesewas, 0);
    assert.equal(res.employee_pesewas, 0);
    assert.equal(res.employer_pesewas, 0);
  });

  it('applies optional SSNIT minimum insurable earnings floor when configured', () => {
    const floorConfig: PayrollTaxConfigInput = {
      ...config,
      ssnit_min_insurable_pesewas: 50_000,
    };
    const res = calculateSsnit({
      basicPayPesewas: 30_000,
      grossCashPesewas: 30_000,
      ssnitExempt: false,
      taxConfig: floorConfig,
    });
    assert.equal(res.pensionable_pesewas, 50_000);
    assert.equal(res.employee_pesewas, 2_750);
    assert.equal(res.employer_pesewas, 6_500);
  });
});

describe('Effective-date statutory config selection', () => {
  it('picks the latest active config whose effective_from <= pay period date', () => {
    const configs = [
      { id: 'c2023', effective_from: '2023-01-01', is_active: 1 },
      { id: 'c2024', effective_from: '2024-01-01', is_active: 1 },
      { id: 'c2026', effective_from: '2026-06-01', is_active: 1 },
      { id: 'c2025-archived', effective_from: '2025-01-01', is_active: 0 },
    ];
    assert.equal(selectEffectiveTaxConfig(configs, '2023-12-31')?.id, 'c2023');
    assert.equal(selectEffectiveTaxConfig(configs, '2025-05-31')?.id, 'c2024');
    assert.equal(selectEffectiveTaxConfig(configs, '2026-06-01')?.id, 'c2026');
    assert.equal(selectEffectiveTaxConfig(configs, '2022-01-01')?.id, 'c2023');
  });
});

describe('Pay types, overtime, absence, and sales commission', () => {
  it('computes base pay across monthly, weekly, daily, and per_shift pay types', () => {
    assert.equal(
      calculatePeriodBasePay({ payType: 'monthly', ratePesewas: 250_000, daysWorked: 20, shiftsWorked: 20, workingDaysPerMonth: 26 }),
      250_000
    );
    assert.equal(
      calculatePeriodBasePay({ payType: 'weekly', ratePesewas: 60_000, daysWorked: 18, shiftsWorked: 18, workingDaysPerMonth: 26 }),
      180_000 // 18 days / 6 days-per-week = 3 weeks
    );
    assert.equal(
      calculatePeriodBasePay({ payType: 'daily', ratePesewas: 10_000, daysWorked: 12.5, shiftsWorked: 13, workingDaysPerMonth: 26 }),
      125_000
    );
    assert.equal(
      calculatePeriodBasePay({ payType: 'per_shift', ratePesewas: 8_500, daysWorked: 10, shiftsWorked: 15, workingDaysPerMonth: 26 }),
      127_500
    );
  });

  it('calculates overtime pay accurately in integer pesewas', () => {
    // Monthly GH₵ 2,080 / (26 days * 8 hrs = 208 hrs) = GH₵ 10/hr -> 2 hrs @ 1.5x = GH₵ 30 (3,000 p)
    const ot = calculateOvertimePay({
      payType: 'monthly',
      ratePesewas: 208_000,
      overtimeMinutes: 120,
      rules: DEFAULT_RULES,
    });
    assert.equal(ot, 3_000);
  });

  it('calculates absence deductions for monthly staff only', () => {
    // 2 absent days out of 26 on GH₵ 2,600 = GH₵ 200 (20,000 p)
    assert.equal(
      calculateAbsenceDeduction({
        payType: 'monthly',
        basicPayForPeriodPesewas: 260_000,
        absentDays: 2,
        rules: DEFAULT_RULES,
      }),
      20_000
    );
    // Fixed per-day absence mode
    assert.equal(
      calculateAbsenceDeduction({
        payType: 'monthly',
        basicPayForPeriodPesewas: 260_000,
        absentDays: 1.5,
        rules: { ...DEFAULT_RULES, absence_deduction_mode: 'fixed_pesewas', absence_fixed_deduction_pesewas: 8_000 },
      }),
      12_000
    );
    // None mode
    assert.equal(
      calculateAbsenceDeduction({
        payType: 'monthly',
        basicPayForPeriodPesewas: 260_000,
        absentDays: 3,
        rules: { ...DEFAULT_RULES, absence_deduction_mode: 'none' },
      }),
      0
    );
    // Daily staff already paid only for days worked -> 0 extra deduction
    assert.equal(
      calculateAbsenceDeduction({
        payType: 'daily',
        basicPayForPeriodPesewas: 200_000,
        absentDays: 2,
        rules: DEFAULT_RULES,
      }),
      0
    );
  });

  it('calculates cashier sales commission with optional sales threshold', () => {
    assert.equal(
      calculateSalesCommission({
        commissionEnabled: true,
        commissionRateBps: 150, // 1.5%
        commissionMinSalesPesewas: 1_000_000, // GH₵ 10,000 min
        salesTotalPesewas: 999_999,
      }),
      0
    );
    assert.equal(
      calculateSalesCommission({
        commissionEnabled: true,
        commissionRateBps: 150, // 1.5%
        commissionMinSalesPesewas: 1_000_000,
        salesTotalPesewas: 2_000_000, // GH₵ 20,000 -> GH₵ 300 commission
      }),
      30_000
    );
  });
});

describe('Full end-to-end payslip calculation', () => {
  it('computes gross, SSNIT, PAYE, loan repayment, net pay, and employer cost accurately', () => {
    const result = calculatePayslip({
      payType: 'monthly',
      basicRatePesewas: 200_000, // GH₵ 2,000.00
      allowances: [
        { id: 'a1', name: 'Transport', amount_pesewas: 30_000, is_taxable: true }, // GH₵ 300.00
        { id: 'a2', name: 'Meals', amount_pesewas: 20_000, is_taxable: true }, // GH₵ 200.00
      ],
      daysWorked: 26,
      shiftsWorked: 26,
      overtimeMinutes: 0,
      absentDays: 0,
      ssnitExempt: false,
      commissionEnabled: true,
      commissionRateBps: 100, // 1%
      commissionMinSalesPesewas: 0,
      salesTotalPesewas: 1_000_000, // GH₵ 10,000 sales -> GH₵ 100.00 commission
      bonusPesewas: 0,
      activeDeductions: [
        {
          id: 'd1',
          kind: 'advance',
          reason: 'Mid-month advance',
          monthly_repayment_pesewas: 20_000, // GH₵ 200.00
          remaining_balance_pesewas: 20_000,
          start_month: '2026-01',
          status: 'active',
        },
      ],
      payMonth: '2026-05',
      taxConfig: DEFAULT_GHANA_TAX_CONFIG_INPUT,
      rules: DEFAULT_RULES,
    });

    // Gross = 200,000 + 50,000 + 10,000 = 260,000 (GH₵ 2,600.00)
    assert.equal(result.gross_pay_pesewas, 260_000);
    // SSNIT on basic (200,000): employee = 11,000 (GH₵ 110), employer = 26,000 (GH₵ 260)
    assert.equal(result.ssnit.employee_pesewas, 11_000);
    assert.equal(result.ssnit.employer_pesewas, 26_000);
    // Chargeable income = 260,000 - 11,000 = 249,000 (GH₵ 2,490.00)
    assert.equal(result.paye.chargeable_income_pesewas, 249_000);
    // PAYE on 249,000:
    // 49,000 @ 0% = 0
    // 11,000 @ 5% = 550
    // 13,000 @ 10% = 1,300
    // 176,000 @ 17.5% = 30,800
    // Total PAYE = 32,650 (GH₵ 326.50)
    assert.equal(result.paye.tax_pesewas, 32_650);
    // Other deductions = 20,000 (advance fully paid off -> remaining 0)
    assert.equal(result.total_other_deductions_pesewas, 20_000);
    assert.equal(result.applied_deductions[0].remaining_after_pesewas, 0);
    // Net pay = 260,000 - 11,000 - 32,650 - 20,000 = 196,350 (GH₵ 1,963.50)
    assert.equal(result.net_pay_pesewas, 196_350);
    // Employer cost = Gross 260,000 + Employer SSNIT 26,000 = 286,000 (GH₵ 2,860.00)
    assert.equal(result.employer_cost_pesewas, 286_000);
  });

  it('caps loan/fine deductions so net pay never goes negative', () => {
    const result = calculatePayslip({
      payType: 'monthly',
      basicRatePesewas: 50_000, // GH₵ 500
      allowances: [],
      daysWorked: 26,
      shiftsWorked: 26,
      overtimeMinutes: 0,
      absentDays: 0,
      ssnitExempt: false,
      commissionEnabled: false,
      commissionRateBps: 0,
      commissionMinSalesPesewas: 0,
      salesTotalPesewas: 0,
      bonusPesewas: 0,
      activeDeductions: [
        {
          id: 'd-big',
          kind: 'loan',
          reason: 'Large loan',
          monthly_repayment_pesewas: 100_000, // exceeds net pay
          remaining_balance_pesewas: 100_000,
          start_month: '2026-01',
          status: 'active',
        },
      ],
      payMonth: '2026-05',
      taxConfig: DEFAULT_GHANA_TAX_CONFIG_INPUT,
      rules: DEFAULT_RULES,
    });

    // SSNIT employee = 2,750; chargeable = 47,250 <= 49,000 -> PAYE = 0
    // Available = 47,250 -> loan takes 47,250, leaves 52,750 remaining, net pay = 0
    assert.equal(result.net_pay_pesewas, 0);
    assert.equal(result.applied_deductions[0].applied_pesewas, 47_250);
    assert.equal(result.applied_deductions[0].remaining_after_pesewas, 52_750);
  });

  it('excludes non-taxable allowances from PAYE chargeable income', () => {
    const result = calculatePayslip({
      payType: 'monthly',
      basicRatePesewas: 100_000,
      allowances: [
        { id: 'a1', name: 'Reimbursement', amount_pesewas: 50_000, is_taxable: false },
      ],
      daysWorked: 26,
      shiftsWorked: 26,
      overtimeMinutes: 0,
      absentDays: 0,
      ssnitExempt: false,
      commissionEnabled: false,
      commissionRateBps: 0,
      commissionMinSalesPesewas: 0,
      salesTotalPesewas: 0,
      bonusPesewas: 0,
      activeDeductions: [],
      payMonth: '2026-05',
      taxConfig: DEFAULT_GHANA_TAX_CONFIG_INPUT,
      rules: DEFAULT_RULES,
    });

    assert.equal(result.gross_pay_pesewas, 150_000);
    assert.equal(result.ssnit.employee_pesewas, 5_500);
    // Chargeable = 100,000 - 5,500 = 94,500 (50,000 non-taxable excluded)
    assert.equal(result.paye.chargeable_income_pesewas, 94_500);
  });
});

describe('Statutory filing due date & period bounds', () => {
  it('computes 15th of following month including December -> January year rollover', () => {
    assert.equal(getStatutoryFilingDueDate('2026-05'), '2026-06-15');
    assert.equal(getStatutoryFilingDueDate('2026-12'), '2027-01-15');
    assert.deepEqual(getMonthPeriodBounds('2026-02'), {
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    });
    assert.deepEqual(getMonthPeriodBounds('2024-02'), {
      periodStart: '2024-02-01',
      periodEnd: '2024-02-29',
    });
  });
});

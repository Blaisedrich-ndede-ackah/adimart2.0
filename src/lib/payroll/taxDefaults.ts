import type {
  LocalPayrollRules,
  LocalPayrollTaxConfig,
  PayeTaxBand,
  PayrollTaxConfigInput,
} from './types.ts';

/**
 * Seeded Ghana statutory payroll defaults (effective 2024-01-01).
 *
 * IMPORTANT: These values are ONLY initial editable seeds stored in Dexie so
 * shop owners can get started offline immediately. They are NEVER hard-coded
 * in the calculation engine and MUST be marked "Verify with your accountant"
 * until reviewed and confirmed for the current tax year.
 *
 * Basis of seeded defaults:
 * - GRA Monthly PAYE Graduated Schedule (Income Tax Amendment Act, 2023 / 2024 schedule)
 * - SSNIT Act 766 rates: 5.5% employee share, 13.0% employer share (18.5% combined)
 * - SSNIT monthly maximum insurable earnings cap (updated periodically by SSNIT)
 */
export const ACCOUNTANT_VERIFY_NOTICE =
  'Verify with your accountant — seeded defaults may change when GRA or SSNIT publishes updated rates or caps.';

export const DEFAULT_GHANA_PAYE_BANDS: PayeTaxBand[] = [
  { label: 'Tax-free threshold (first GH₵ 490)', width_pesewas: 49_000, rate_bps: 0 },
  { label: 'Next GH₵ 110 @ 5%', width_pesewas: 11_000, rate_bps: 500 },
  { label: 'Next GH₵ 130 @ 10%', width_pesewas: 13_000, rate_bps: 1_000 },
  { label: 'Next GH₵ 3,166.67 @ 17.5%', width_pesewas: 316_667, rate_bps: 1_750 },
  { label: 'Next GH₵ 16,000 @ 25%', width_pesewas: 1_600_000, rate_bps: 2_500 },
  { label: 'Next GH₵ 30,520 @ 30%', width_pesewas: 3_052_000, rate_bps: 3_000 },
  { label: 'Exceeding GH₵ 50,416.67 @ 35%', width_pesewas: null, rate_bps: 3_500 },
];

export const DEFAULT_GHANA_TAX_CONFIG_INPUT: PayrollTaxConfigInput = {
  effective_from: '2024-01-01',
  tax_free_threshold_pesewas: 49_000, // GH₵ 490.00 / month
  paye_bands: DEFAULT_GHANA_PAYE_BANDS,
  ssnit_employee_rate_bps: 550, // 5.5%
  ssnit_employer_rate_bps: 1_300, // 13.0%
  ssnit_max_insurable_pesewas: 5_200_000, // GH₵ 52,000.00 / month — verify current year cap with accountant
  ssnit_min_insurable_pesewas: 0,
  ssnit_basis: 'basic_only',
};

export function createSeededTaxConfig(id: string, storeId: string, nowIso: string): LocalPayrollTaxConfig {
  return {
    id,
    store_id: storeId,
    name: 'Ghana Statutory Defaults (Verify with your accountant)',
    effective_from: DEFAULT_GHANA_TAX_CONFIG_INPUT.effective_from,
    tax_free_threshold_pesewas: DEFAULT_GHANA_TAX_CONFIG_INPUT.tax_free_threshold_pesewas,
    paye_bands_json: JSON.stringify(DEFAULT_GHANA_PAYE_BANDS),
    ssnit_employee_rate_bps: DEFAULT_GHANA_TAX_CONFIG_INPUT.ssnit_employee_rate_bps,
    ssnit_employer_rate_bps: DEFAULT_GHANA_TAX_CONFIG_INPUT.ssnit_employer_rate_bps,
    ssnit_max_insurable_pesewas: DEFAULT_GHANA_TAX_CONFIG_INPUT.ssnit_max_insurable_pesewas,
    ssnit_min_insurable_pesewas: DEFAULT_GHANA_TAX_CONFIG_INPUT.ssnit_min_insurable_pesewas,
    ssnit_basis: DEFAULT_GHANA_TAX_CONFIG_INPUT.ssnit_basis,
    verified_with_accountant: 0,
    verified_at: null,
    notes: ACCOUNTANT_VERIFY_NOTICE,
    is_active: 1,
    created_at: nowIso,
    updated_at: nowIso,
    synced: 0,
  };
}

export function createSeededPayrollRules(id: string, storeId: string, nowIso: string): LocalPayrollRules {
  return {
    id,
    store_id: storeId,
    standard_hours_per_day: 8,
    working_days_per_month: 26,
    overtime_multiplier_bps: 15_000, // 1.5x hourly rate
    absence_deduction_mode: 'daily_prorata',
    absence_fixed_deduction_pesewas: 0,
    default_commission_rate_bps: 100, // 1.0% of sales
    post_to_expenses: 1,
    post_to_cashbook: 1,
    filing_due_day: 15, // GRA PAYE & SSNIT due by 15th of following month
    updated_at: nowIso,
    synced: 0,
  };
}

export function parsePayeBands(json: string): PayeTaxBand[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_GHANA_PAYE_BANDS;
    return parsed.map((band, index) => ({
      label: typeof band?.label === 'string' && band.label.trim() ? band.label.trim() : `Band ${index + 1}`,
      width_pesewas:
        band?.width_pesewas === null || band?.width_pesewas === undefined || band?.width_pesewas === ''
          ? null
          : Math.max(0, Math.round(Number(band.width_pesewas) || 0)),
      rate_bps: Math.max(0, Math.round(Number(band?.rate_bps) || 0)),
    }));
  } catch {
    return DEFAULT_GHANA_PAYE_BANDS;
  }
}

export function taxConfigToInput(config: LocalPayrollTaxConfig): PayrollTaxConfigInput {
  const bands = parsePayeBands(config.paye_bands_json);
  return {
    effective_from: config.effective_from,
    tax_free_threshold_pesewas: Math.max(0, Math.round(config.tax_free_threshold_pesewas || 0)),
    paye_bands: bands,
    ssnit_employee_rate_bps: Math.max(0, Math.round(config.ssnit_employee_rate_bps || 0)),
    ssnit_employer_rate_bps: Math.max(0, Math.round(config.ssnit_employer_rate_bps || 0)),
    ssnit_max_insurable_pesewas: Math.max(0, Math.round(config.ssnit_max_insurable_pesewas || 0)),
    ssnit_min_insurable_pesewas: Math.max(0, Math.round(config.ssnit_min_insurable_pesewas || 0)),
    ssnit_basis: config.ssnit_basis === 'gross_cash' ? 'gross_cash' : 'basic_only',
  };
}

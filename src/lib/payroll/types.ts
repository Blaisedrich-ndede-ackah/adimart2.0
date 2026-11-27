/**
 * Offline-first Payroll module data types for ADIMAT.
 * All monetary amounts are stored as exact integer pesewas (1 GHS = 100 pesewas)
 * to eliminate floating-point rounding drift.
 */

export type PayrollPayType = 'monthly' | 'weekly' | 'daily' | 'per_shift';
export type PayrollPaymentMethod = 'momo' | 'bank' | 'cash';
export type PayrollDeductionKind = 'loan' | 'advance' | 'fine';
export type PayrollDeductionStatus = 'active' | 'paid_off' | 'paused' | 'cancelled';
export type PayrollAttendanceStatus = 'present' | 'absent' | 'paid_leave' | 'unpaid_leave' | 'half_day';
export type PayrollRunStatus = 'draft' | 'reviewed' | 'approved' | 'locked';
export type PayrollPaymentStatus = 'unpaid' | 'paid';
export type PayrollAbsenceMode = 'none' | 'daily_prorata' | 'fixed_pesewas';
export type PayrollSsnitBasis = 'basic_only' | 'gross_cash';
export type PayrollAdjustmentType = 'bonus' | 'correction' | 'deduction' | 'allowance' | 'reimbursement';

export type PayrollAuditEntityType =
  | 'staff'
  | 'tax_config'
  | 'rules'
  | 'deduction'
  | 'attendance'
  | 'pay_run'
  | 'payment'
  | 'adjustment';

export interface PayrollAllowanceItem {
  id: string;
  name: string;
  /** Monthly / per-period allowance in integer pesewas. */
  amount_pesewas: number;
  /** Whether this allowance is included in PAYE chargeable income. */
  is_taxable: boolean;
}

export interface PayeTaxBand {
  label: string;
  /**
   * Width of this monthly band in integer pesewas.
   * `null` means "all income above previous bands" (top band).
   */
  width_pesewas: number | null;
  /** Rate in basis points: 500 = 5%, 1750 = 17.5%, 3500 = 35%. */
  rate_bps: number;
}

export interface PayeBandSlice {
  label: string;
  rate_bps: number;
  taxable_pesewas: number;
  tax_pesewas: number;
}

export interface AppliedLoanDeduction {
  deduction_id: string;
  kind: PayrollDeductionKind;
  reason: string;
  scheduled_pesewas: number;
  applied_pesewas: number;
  remaining_after_pesewas: number;
}

export interface LocalPayrollStaff {
  id: string;
  store_id: string;
  /** Shop or branch id from db.locations (nullable = default/unassigned shop). */
  location_id: string | null;
  /** Optional link to db.users so POS sales commissions, attendance & cashier payslip access match. */
  user_id: string | null;
  full_name: string;
  role_title: string;
  phone: string;
  /** YYYY-MM-DD */
  start_date: string;
  pay_type: PayrollPayType;
  /** Basic rate in integer pesewas (per month / week / day / shift depending on pay_type). */
  basic_pay_pesewas: number;
  /** Serialized PayrollAllowanceItem[] */
  allowances_json: string;
  payment_method: PayrollPaymentMethod;
  momo_network: string;
  momo_number: string;
  momo_account_name: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  bank_branch: string;
  ssnit_number: string;
  tin_number: string;
  /** 1 = exempt from SSNIT deduction/contribution, 0 = standard SSNIT applies. */
  ssnit_exempt: number;
  /** 1 = auto-calculate sales commission from POS transactions where cashier_id = user_id. */
  commission_enabled: number;
  /** Basis points of POS sales: 100 = 1.00%, 250 = 2.50%. */
  commission_rate_bps: number;
  /** Minimum monthly POS sales in pesewas before commission applies. */
  commission_min_sales_pesewas: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollDeduction {
  id: string;
  store_id: string;
  staff_id: string;
  kind: PayrollDeductionKind;
  reason: string;
  total_amount_pesewas: number;
  monthly_repayment_pesewas: number;
  remaining_balance_pesewas: number;
  /** YYYY-MM first month to start deducting. */
  start_month: string;
  status: PayrollDeductionStatus;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollDeductionRepayment {
  id: string;
  store_id: string;
  deduction_id: string;
  staff_id: string;
  pay_run_id: string;
  pay_month: string;
  amount_pesewas: number;
  balance_after_pesewas: number;
  created_at: string;
  synced: number;
}

export interface LocalPayrollAttendance {
  id: string;
  store_id: string;
  staff_id: string;
  location_id: string | null;
  /** YYYY-MM-DD */
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  worked_minutes: number;
  overtime_minutes: number;
  status: PayrollAttendanceStatus;
  notes: string;
  recorded_by: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollTaxConfig {
  id: string;
  store_id: string;
  name: string;
  /** YYYY-MM-DD date from which these statutory rates take effect. */
  effective_from: string;
  /** First monthly tax-free band in integer pesewas (mirrors band 0 width when band 0 is 0%). */
  tax_free_threshold_pesewas: number;
  /** Serialized PayeTaxBand[] */
  paye_bands_json: string;
  /** Employee SSNIT share in basis points (e.g. 550 = 5.5%). */
  ssnit_employee_rate_bps: number;
  /** Employer SSNIT share in basis points (e.g. 1300 = 13.0%). */
  ssnit_employer_rate_bps: number;
  /** Monthly SSNIT maximum insurable earnings cap in integer pesewas (0 = uncapped). */
  ssnit_max_insurable_pesewas: number;
  /** Optional monthly minimum insurable earnings in integer pesewas (0 = no floor). */
  ssnit_min_insurable_pesewas: number;
  ssnit_basis: PayrollSsnitBasis;
  /** 0 = seeded default, show "Verify with your accountant" warning; 1 = confirmed by owner. */
  verified_with_accountant: number;
  verified_at: string | null;
  notes: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollRules {
  id: string;
  store_id: string;
  standard_hours_per_day: number;
  working_days_per_month: number;
  /** Basis points multiplier: 15000 = 1.5x hourly rate, 20000 = 2.0x. */
  overtime_multiplier_bps: number;
  absence_deduction_mode: PayrollAbsenceMode;
  absence_fixed_deduction_pesewas: number;
  default_commission_rate_bps: number;
  /** 1 = automatically post payroll cost to Expenses (shows in Reports profit). */
  post_to_expenses: number;
  /** 1 = automatically post payroll outflow to Cash Book. */
  post_to_cashbook: number;
  /** Day of following month when GRA PAYE & SSNIT filing is due (default 15). */
  filing_due_day: number;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollRun {
  id: string;
  store_id: string;
  /** YYYY-MM */
  pay_month: string;
  /** YYYY-MM-DD */
  period_start: string;
  /** YYYY-MM-DD */
  period_end: string;
  status: PayrollRunStatus;
  tax_config_id: string;
  /** Frozen LocalPayrollTaxConfig snapshot used when this pay run was calculated. */
  tax_config_snapshot_json: string;
  /** Frozen LocalPayrollRules snapshot used when this pay run was calculated. */
  rules_snapshot_json: string;
  staff_count: number;
  total_gross_pesewas: number;
  total_ssnit_employee_pesewas: number;
  total_ssnit_employer_pesewas: number;
  total_paye_pesewas: number;
  total_other_deductions_pesewas: number;
  total_net_pesewas: number;
  total_employer_cost_pesewas: number;
  expense_entry_id: string | null;
  cash_book_entry_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollRunItem {
  id: string;
  store_id: string;
  pay_run_id: string;
  pay_month: string;
  staff_id: string;
  user_id: string | null;
  staff_name: string;
  role_title: string;
  location_id: string | null;
  location_name: string;
  pay_type: PayrollPayType;
  days_worked: number;
  shifts_worked: number;
  worked_minutes: number;
  overtime_minutes: number;
  absent_days: number;
  basic_pay_pesewas: number;
  allowances_json: string;
  total_allowances_pesewas: number;
  overtime_pay_pesewas: number;
  sales_total_pesewas: number;
  commission_pesewas: number;
  bonus_pesewas: number;
  absence_deduction_pesewas: number;
  gross_pay_pesewas: number;
  ssnit_pensionable_pesewas: number;
  ssnit_employee_pesewas: number;
  ssnit_employer_pesewas: number;
  chargeable_income_pesewas: number;
  paye_pesewas: number;
  paye_breakdown_json: string;
  loan_deductions_json: string;
  total_other_deductions_pesewas: number;
  total_deductions_pesewas: number;
  net_pay_pesewas: number;
  employer_cost_pesewas: number;
  payment_method: PayrollPaymentMethod;
  payment_destination: string;
  payment_status: PayrollPaymentStatus;
  paid_at: string | null;
  paid_by: string | null;
  payment_reference: string;
  notes: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalPayrollAdjustment {
  id: string;
  store_id: string;
  pay_run_id: string;
  run_item_id: string;
  staff_id: string;
  staff_name: string;
  pay_month: string;
  adjustment_type: PayrollAdjustmentType;
  /** Signed integer pesewas added to (positive) or subtracted from (negative) staff net pay. */
  delta_net_pesewas: number;
  /** Signed integer pesewas impact on employer total cost. */
  delta_employer_cost_pesewas: number;
  reason: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  synced: number;
}

export interface LocalPayrollAuditLog {
  id: string;
  store_id: string;
  entity_type: PayrollAuditEntityType;
  entity_id: string;
  action: string;
  summary: string;
  before_json: string;
  after_json: string;
  actor_id: string;
  actor_name: string;
  created_at: string;
  synced: number;
}

export interface PayrollTaxConfigInput {
  effective_from: string;
  tax_free_threshold_pesewas: number;
  paye_bands: PayeTaxBand[];
  ssnit_employee_rate_bps: number;
  ssnit_employer_rate_bps: number;
  ssnit_max_insurable_pesewas: number;
  ssnit_min_insurable_pesewas: number;
  ssnit_basis: PayrollSsnitBasis;
}

export interface PayrollRulesInput {
  standard_hours_per_day: number;
  working_days_per_month: number;
  overtime_multiplier_bps: number;
  absence_deduction_mode: PayrollAbsenceMode;
  absence_fixed_deduction_pesewas: number;
}

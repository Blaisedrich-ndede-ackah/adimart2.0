-- ============================================================
-- ADIMAT POS - Offline-First Store Owner Payroll Module
-- Money columns are stored as exact BIGINT pesewas (1 GHS = 100 pesewas).
-- Run after supabase-init.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payroll_staff (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  location_id UUID,
  user_id UUID,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT 'Staff',
  phone TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('monthly', 'weekly', 'daily', 'per_shift')),
  basic_pay_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (basic_pay_pesewas >= 0),
  allowances_json TEXT NOT NULL DEFAULT '[]',
  payment_method TEXT NOT NULL DEFAULT 'momo' CHECK (payment_method IN ('momo', 'bank', 'cash')),
  momo_network TEXT NOT NULL DEFAULT '',
  momo_number TEXT NOT NULL DEFAULT '',
  momo_account_name TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  ssnit_number TEXT NOT NULL DEFAULT '',
  tin_number TEXT NOT NULL DEFAULT '',
  ssnit_exempt SMALLINT NOT NULL DEFAULT 0,
  commission_enabled SMALLINT NOT NULL DEFAULT 0,
  commission_rate_bps INTEGER NOT NULL DEFAULT 0,
  commission_min_sales_pesewas BIGINT NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_deductions (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('loan', 'advance', 'fine')),
  reason TEXT NOT NULL DEFAULT '',
  total_amount_pesewas BIGINT NOT NULL DEFAULT 0,
  monthly_repayment_pesewas BIGINT NOT NULL DEFAULT 0,
  remaining_balance_pesewas BIGINT NOT NULL DEFAULT 0,
  start_month VARCHAR(7) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off', 'paused', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_deduction_repayments (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  deduction_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  pay_run_id UUID NOT NULL,
  pay_month VARCHAR(7) NOT NULL,
  amount_pesewas BIGINT NOT NULL DEFAULT 0,
  balance_after_pesewas BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_attendance (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  location_id UUID,
  work_date DATE NOT NULL,
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'paid_leave', 'unpaid_leave', 'half_day')),
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_tax_configs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  effective_from DATE NOT NULL,
  tax_free_threshold_pesewas BIGINT NOT NULL DEFAULT 0,
  paye_bands_json TEXT NOT NULL DEFAULT '[]',
  ssnit_employee_rate_bps INTEGER NOT NULL DEFAULT 550,
  ssnit_employer_rate_bps INTEGER NOT NULL DEFAULT 1300,
  ssnit_max_insurable_pesewas BIGINT NOT NULL DEFAULT 0,
  ssnit_min_insurable_pesewas BIGINT NOT NULL DEFAULT 0,
  ssnit_basis TEXT NOT NULL DEFAULT 'basic_only' CHECK (ssnit_basis IN ('basic_only', 'gross_cash')),
  verified_with_accountant SMALLINT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_rules (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  standard_hours_per_day NUMERIC(5,2) NOT NULL DEFAULT 8,
  working_days_per_month INTEGER NOT NULL DEFAULT 26,
  overtime_multiplier_bps INTEGER NOT NULL DEFAULT 15000,
  absence_deduction_mode TEXT NOT NULL DEFAULT 'daily_prorata' CHECK (absence_deduction_mode IN ('none', 'daily_prorata', 'fixed_pesewas')),
  absence_fixed_deduction_pesewas BIGINT NOT NULL DEFAULT 0,
  default_commission_rate_bps INTEGER NOT NULL DEFAULT 100,
  post_to_expenses SMALLINT NOT NULL DEFAULT 1,
  post_to_cashbook SMALLINT NOT NULL DEFAULT 1,
  filing_due_day INTEGER NOT NULL DEFAULT 15,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pay_month VARCHAR(7) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved', 'locked')),
  tax_config_id UUID NOT NULL,
  tax_config_snapshot_json TEXT NOT NULL DEFAULT '{}',
  rules_snapshot_json TEXT NOT NULL DEFAULT '{}',
  staff_count INTEGER NOT NULL DEFAULT 0,
  total_gross_pesewas BIGINT NOT NULL DEFAULT 0,
  total_ssnit_employee_pesewas BIGINT NOT NULL DEFAULT 0,
  total_ssnit_employer_pesewas BIGINT NOT NULL DEFAULT 0,
  total_paye_pesewas BIGINT NOT NULL DEFAULT 0,
  total_other_deductions_pesewas BIGINT NOT NULL DEFAULT 0,
  total_net_pesewas BIGINT NOT NULL DEFAULT 0,
  total_employer_cost_pesewas BIGINT NOT NULL DEFAULT 0,
  expense_entry_id UUID,
  cash_book_entry_id UUID,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_run_items (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pay_run_id UUID NOT NULL,
  pay_month VARCHAR(7) NOT NULL,
  staff_id UUID NOT NULL,
  user_id UUID,
  staff_name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  location_id UUID,
  location_name TEXT NOT NULL DEFAULT '',
  pay_type TEXT NOT NULL DEFAULT 'monthly',
  days_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
  shifts_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  absent_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  basic_pay_pesewas BIGINT NOT NULL DEFAULT 0,
  allowances_json TEXT NOT NULL DEFAULT '[]',
  total_allowances_pesewas BIGINT NOT NULL DEFAULT 0,
  overtime_pay_pesewas BIGINT NOT NULL DEFAULT 0,
  sales_total_pesewas BIGINT NOT NULL DEFAULT 0,
  commission_pesewas BIGINT NOT NULL DEFAULT 0,
  bonus_pesewas BIGINT NOT NULL DEFAULT 0,
  absence_deduction_pesewas BIGINT NOT NULL DEFAULT 0,
  gross_pay_pesewas BIGINT NOT NULL DEFAULT 0,
  ssnit_pensionable_pesewas BIGINT NOT NULL DEFAULT 0,
  ssnit_employee_pesewas BIGINT NOT NULL DEFAULT 0,
  ssnit_employer_pesewas BIGINT NOT NULL DEFAULT 0,
  chargeable_income_pesewas BIGINT NOT NULL DEFAULT 0,
  paye_pesewas BIGINT NOT NULL DEFAULT 0,
  paye_breakdown_json TEXT NOT NULL DEFAULT '[]',
  loan_deductions_json TEXT NOT NULL DEFAULT '[]',
  total_other_deductions_pesewas BIGINT NOT NULL DEFAULT 0,
  total_deductions_pesewas BIGINT NOT NULL DEFAULT 0,
  net_pay_pesewas BIGINT NOT NULL DEFAULT 0,
  employer_cost_pesewas BIGINT NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'momo',
  payment_destination TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  paid_at TIMESTAMPTZ,
  paid_by TEXT,
  payment_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pay_run_id UUID NOT NULL,
  run_item_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  staff_name TEXT NOT NULL DEFAULT '',
  pay_month VARCHAR(7) NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('bonus', 'correction', 'deduction', 'allowance', 'reimbursement')),
  delta_net_pesewas BIGINT NOT NULL DEFAULT 0,
  delta_employer_cost_pesewas BIGINT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payroll_audit_logs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '',
  after_json TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_staff_store ON public.payroll_staff (store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_store ON public.payroll_deductions (store_id, staff_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_repayments_store ON public.payroll_deduction_repayments (store_id, pay_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_attendance_store ON public.payroll_attendance (store_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_tax_configs_store ON public.payroll_tax_configs (store_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_store ON public.payroll_runs (store_id, pay_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_run_items_run ON public.payroll_run_items (pay_run_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_run ON public.payroll_adjustments (pay_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_store ON public.payroll_audit_logs (store_id, created_at DESC);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'payroll_staff',
    'payroll_deductions',
    'payroll_deduction_repayments',
    'payroll_attendance',
    'payroll_tax_configs',
    'payroll_rules',
    'payroll_runs',
    'payroll_run_items',
    'payroll_adjustments',
    'payroll_audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO anon, authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_all', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      tbl || '_all',
      tbl
    );
  END LOOP;
END $$;

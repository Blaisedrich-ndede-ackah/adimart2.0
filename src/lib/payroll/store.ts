import {
  db,
  generateId,
  type LocalCashBookEntry,
  type LocalExpense,
  type LocalLocation,
} from '@/lib/dexie';
import { stableUuid } from '@/lib/ids';
import { isCountedSale } from '@/lib/saleStatus';
import { triggerPushSync } from '@/lib/sync';
import {
  calculatePayslip,
  formatPesewas,
  getMonthPeriodBounds,
  getStatutoryFilingDueDate,
  ghsToPesewas,
  pesewasToGhs,
  selectEffectiveTaxConfig,
} from './calculator';
import {
  createSeededPayrollRules,
  createSeededTaxConfig,
  parsePayeBands,
  taxConfigToInput,
} from './taxDefaults';
import type {
  AppliedLoanDeduction,
  LocalPayrollAdjustment,
  LocalPayrollAttendance,
  LocalPayrollAuditLog,
  LocalPayrollDeduction,
  LocalPayrollDeductionRepayment,
  LocalPayrollRules,
  LocalPayrollRun,
  LocalPayrollRunItem,
  LocalPayrollStaff,
  LocalPayrollTaxConfig,
  PayrollAdjustmentType,
  PayrollAllowanceItem,
  PayrollAttendanceStatus,
  PayrollAuditEntityType,
  PayrollDeductionKind,
  PayrollDeductionStatus,
  PayrollPaymentMethod,
  PayrollPayType,
} from './types';

export interface PayrollActor {
  id: string;
  name: string;
}

export function currentPayMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function todayDateOnly(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseAllowances(json: string): PayrollAllowanceItem[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && item.name.trim())
      .map((item, idx) => ({
        id: typeof item.id === 'string' && item.id ? item.id : `allow_${idx}`,
        name: item.name.trim(),
        amount_pesewas: Math.max(0, Math.round(Number(item.amount_pesewas) || 0)),
        is_taxable: item.is_taxable !== false,
      }));
  } catch {
    return [];
  }
}

export function formatPaymentDestination(staff: LocalPayrollStaff): string {
  if (staff.payment_method === 'momo') {
    const parts = [
      staff.momo_network ? `${staff.momo_network} MoMo` : 'Mobile Money',
      staff.momo_number.trim(),
      staff.momo_account_name.trim(),
    ].filter(Boolean);
    return parts.join(' · ') || 'Mobile Money (details missing)';
  }
  if (staff.payment_method === 'bank') {
    const parts = [
      staff.bank_name.trim() || 'Bank Transfer',
      staff.bank_account_number.trim(),
      staff.bank_account_name.trim(),
      staff.bank_branch.trim(),
    ].filter(Boolean);
    return parts.join(' · ') || 'Bank transfer (details missing)';
  }
  return 'Cash at shop';
}

export async function appendPayrollAudit(params: {
  storeId: string;
  entityType: PayrollAuditEntityType;
  entityId: string;
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  actor: PayrollActor;
}): Promise<LocalPayrollAuditLog> {
  const row: LocalPayrollAuditLog = {
    id: generateId(),
    store_id: params.storeId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    summary: params.summary,
    before_json: params.before === undefined ? '' : JSON.stringify(params.before),
    after_json: params.after === undefined ? '' : JSON.stringify(params.after),
    actor_id: params.actor.id,
    actor_name: params.actor.name,
    created_at: new Date().toISOString(),
    synced: 0,
  };
  await db.payroll_audit_logs.add(row);
  return row;
}

/**
 * Ensure the store has at least one editable Ghana statutory tax config
 * (clearly flagged "verify with your accountant") and default payroll rules.
 */
export async function ensurePayrollBootstrap(storeId: string): Promise<{
  taxConfigs: LocalPayrollTaxConfig[];
  rules: LocalPayrollRules;
}> {
  const now = new Date().toISOString();
  let taxConfigs = await db.payroll_tax_configs.where('store_id').equals(storeId).toArray();
  if (taxConfigs.length === 0) {
    const seeded = createSeededTaxConfig(stableUuid(`payroll:tax-default:${storeId}`), storeId, now);
    await db.payroll_tax_configs.put(seeded);
    taxConfigs = [seeded];
  }

  const rulesId = stableUuid(`payroll:rules:${storeId}`);
  let rules = await db.payroll_rules.get(rulesId);
  if (!rules) {
    const existing = await db.payroll_rules.where('store_id').equals(storeId).first();
    if (existing) {
      rules = existing;
    } else {
      rules = createSeededPayrollRules(rulesId, storeId, now);
      await db.payroll_rules.put(rules);
    }
  }

  taxConfigs.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return { taxConfigs, rules };
}

/* ================================================================== */
/*  Staff Records                                                     */
/* ================================================================== */

export async function listPayrollStaff(storeId: string, includeInactive = true): Promise<LocalPayrollStaff[]> {
  const rows = await db.payroll_staff.where('store_id').equals(storeId).toArray();
  const filtered = includeInactive ? rows : rows.filter((r) => r.is_active === 1);
  return filtered.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function getPayrollStaffForUser(storeId: string, userId: string): Promise<LocalPayrollStaff | null> {
  const rows = await db.payroll_staff.where('store_id').equals(storeId).toArray();
  return rows.find((r) => r.user_id === userId && r.is_active === 1)
    || rows.find((r) => r.user_id === userId)
    || null;
}

export interface SavePayrollStaffInput {
  id?: string;
  location_id: string | null;
  user_id: string | null;
  full_name: string;
  role_title: string;
  phone: string;
  start_date: string;
  pay_type: PayrollPayType;
  basic_pay_pesewas: number;
  allowances: PayrollAllowanceItem[];
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
  ssnit_exempt: boolean;
  commission_enabled: boolean;
  commission_rate_bps: number;
  commission_min_sales_pesewas: number;
  is_active: boolean;
}

export async function savePayrollStaff(
  storeId: string,
  input: SavePayrollStaffInput,
  actor: PayrollActor
): Promise<LocalPayrollStaff> {
  const name = input.full_name.trim();
  if (!name) throw new Error('Enter the staff member’s full name.');
  const basic = Math.max(0, Math.round(input.basic_pay_pesewas));
  if (basic <= 0) throw new Error('Basic pay must be greater than zero.');

  const now = new Date().toISOString();
  const existing = input.id ? await db.payroll_staff.get(input.id) : undefined;
  const record: LocalPayrollStaff = {
    id: existing?.id || generateId(),
    store_id: storeId,
    location_id: input.location_id || null,
    user_id: input.user_id || null,
    full_name: name,
    role_title: input.role_title.trim() || 'Staff',
    phone: input.phone.trim(),
    start_date: input.start_date || todayDateOnly(),
    pay_type: input.pay_type,
    basic_pay_pesewas: basic,
    allowances_json: JSON.stringify(
      input.allowances
        .filter((a) => a.name.trim() && a.amount_pesewas > 0)
        .map((a) => ({
          id: a.id || generateId(),
          name: a.name.trim(),
          amount_pesewas: Math.max(0, Math.round(a.amount_pesewas)),
          is_taxable: a.is_taxable !== false,
        }))
    ),
    payment_method: input.payment_method,
    momo_network: input.momo_network.trim(),
    momo_number: input.momo_number.trim(),
    momo_account_name: input.momo_account_name.trim(),
    bank_name: input.bank_name.trim(),
    bank_account_number: input.bank_account_number.trim(),
    bank_account_name: input.bank_account_name.trim(),
    bank_branch: input.bank_branch.trim(),
    ssnit_number: input.ssnit_number.trim(),
    tin_number: input.tin_number.trim(),
    ssnit_exempt: input.ssnit_exempt ? 1 : 0,
    commission_enabled: input.commission_enabled ? 1 : 0,
    commission_rate_bps: Math.max(0, Math.round(input.commission_rate_bps || 0)),
    commission_min_sales_pesewas: Math.max(0, Math.round(input.commission_min_sales_pesewas || 0)),
    is_active: input.is_active ? 1 : 0,
    created_at: existing?.created_at || now,
    updated_at: now,
    synced: 0,
  };

  await db.payroll_staff.put(record);

  const salaryChanged = existing && existing.basic_pay_pesewas !== record.basic_pay_pesewas;
  await appendPayrollAudit({
    storeId,
    entityType: 'staff',
    entityId: record.id,
    action: !existing ? 'staff_created' : salaryChanged ? 'salary_updated' : 'staff_updated',
    summary: !existing
      ? `Added staff ${record.full_name} (${record.role_title}) at ${formatPesewas(record.basic_pay_pesewas)} (${record.pay_type}).`
      : salaryChanged
        ? `Changed ${record.full_name}’s basic pay from ${formatPesewas(existing.basic_pay_pesewas)} to ${formatPesewas(record.basic_pay_pesewas)}.`
        : `Updated staff details for ${record.full_name}.`,
    before: existing,
    after: record,
    actor,
  });

  void triggerPushSync('payroll-staff');
  return record;
}

/* ================================================================== */
/*  Deductions: Loans, Salary Advances, Fines                         */
/* ================================================================== */

export async function listPayrollDeductions(storeId: string): Promise<LocalPayrollDeduction[]> {
  const rows = await db.payroll_deductions.where('store_id').equals(storeId).toArray();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listDeductionRepayments(
  storeId: string,
  deductionId?: string
): Promise<LocalPayrollDeductionRepayment[]> {
  const rows = deductionId
    ? await db.payroll_deduction_repayments.where('deduction_id').equals(deductionId).toArray()
    : await db.payroll_deduction_repayments.where('store_id').equals(storeId).toArray();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function savePayrollDeduction(
  storeId: string,
  input: {
    id?: string;
    staff_id: string;
    kind: PayrollDeductionKind;
    reason: string;
    total_amount_pesewas: number;
    monthly_repayment_pesewas: number;
    start_month: string;
    notes: string;
  },
  actor: PayrollActor
): Promise<LocalPayrollDeduction> {
  const staff = await db.payroll_staff.get(input.staff_id);
  if (!staff || staff.store_id !== storeId) throw new Error('Choose a valid staff member.');
  const total = Math.max(0, Math.round(input.total_amount_pesewas));
  const monthly = Math.max(0, Math.round(input.monthly_repayment_pesewas));
  if (total <= 0) throw new Error('Total deduction amount must be greater than zero.');
  if (monthly <= 0) throw new Error('Monthly repayment amount must be greater than zero.');

  const now = new Date().toISOString();
  const existing = input.id ? await db.payroll_deductions.get(input.id) : undefined;
  const remaining = existing ? existing.remaining_balance_pesewas : total;
  const record: LocalPayrollDeduction = {
    id: existing?.id || generateId(),
    store_id: storeId,
    staff_id: input.staff_id,
    kind: input.kind,
    reason: input.reason.trim() || (input.kind === 'loan' ? 'Staff loan' : input.kind === 'advance' ? 'Salary advance' : 'Fine / shortage'),
    total_amount_pesewas: existing ? existing.total_amount_pesewas : total,
    monthly_repayment_pesewas: Math.min(monthly, Math.max(remaining, monthly)),
    remaining_balance_pesewas: remaining,
    start_month: input.start_month || currentPayMonth(),
    status: remaining <= 0 ? 'paid_off' : (existing?.status || 'active'),
    notes: input.notes.trim(),
    created_by: existing?.created_by || actor.name,
    created_at: existing?.created_at || now,
    updated_at: now,
    synced: 0,
  };

  await db.payroll_deductions.put(record);
  await appendPayrollAudit({
    storeId,
    entityType: 'deduction',
    entityId: record.id,
    action: existing ? 'deduction_updated' : 'deduction_created',
    summary: existing
      ? `Updated ${record.kind} for ${staff.full_name} (${record.reason}), repayment ${formatPesewas(record.monthly_repayment_pesewas)}/month.`
      : `Recorded ${record.kind} of ${formatPesewas(record.total_amount_pesewas)} for ${staff.full_name} (${record.reason}), repaying ${formatPesewas(record.monthly_repayment_pesewas)}/month.`,
    before: existing,
    after: record,
    actor,
  });

  void triggerPushSync('payroll-deduction');
  return record;
}

export async function updateDeductionStatus(
  storeId: string,
  deductionId: string,
  status: PayrollDeductionStatus,
  actor: PayrollActor
): Promise<void> {
  const existing = await db.payroll_deductions.get(deductionId);
  if (!existing || existing.store_id !== storeId) throw new Error('Deduction not found.');
  const updated: LocalPayrollDeduction = {
    ...existing,
    status,
    updated_at: new Date().toISOString(),
    synced: 0,
  };
  await db.payroll_deductions.put(updated);
  await appendPayrollAudit({
    storeId,
    entityType: 'deduction',
    entityId: deductionId,
    action: 'deduction_status_changed',
    summary: `Changed ${existing.kind} (${existing.reason}) status from ${existing.status} to ${status}.`,
    before: existing,
    after: updated,
    actor,
  });
  void triggerPushSync('payroll-deduction');
}

/* ================================================================== */
/*  Attendance & Shifts (Offline Clock In / Out)                      */
/* ================================================================== */

export async function listPayrollAttendance(
  storeId: string,
  payMonth?: string
): Promise<LocalPayrollAttendance[]> {
  const rows = await db.payroll_attendance.where('store_id').equals(storeId).toArray();
  const filtered = payMonth ? rows.filter((r) => r.work_date.startsWith(payMonth)) : rows;
  return filtered.sort((a, b) => b.work_date.localeCompare(a.work_date) || b.created_at.localeCompare(a.created_at));
}

export async function clockInStaff(
  storeId: string,
  staff: LocalPayrollStaff,
  actor: PayrollActor
): Promise<LocalPayrollAttendance> {
  const today = todayDateOnly();
  const existingToday = await db.payroll_attendance
    .where('store_id').equals(storeId)
    .and((r) => r.staff_id === staff.id && r.work_date === today && r.clock_in_at !== null && r.clock_out_at === null)
    .first();
  if (existingToday) return existingToday;

  const now = new Date().toISOString();
  const record: LocalPayrollAttendance = {
    id: generateId(),
    store_id: storeId,
    staff_id: staff.id,
    location_id: staff.location_id,
    work_date: today,
    clock_in_at: now,
    clock_out_at: null,
    worked_minutes: 0,
    overtime_minutes: 0,
    status: 'present',
    notes: '',
    recorded_by: actor.name,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.payroll_attendance.add(record);
  void triggerPushSync('payroll-attendance');
  return record;
}

export async function clockOutStaff(
  storeId: string,
  attendanceId: string,
  actor: PayrollActor
): Promise<LocalPayrollAttendance> {
  const record = await db.payroll_attendance.get(attendanceId);
  if (!record || record.store_id !== storeId) throw new Error('Shift record not found.');
  const { rules } = await ensurePayrollBootstrap(storeId);
  const now = new Date();
  const nowIso = now.toISOString();
  const startMs = record.clock_in_at ? Date.parse(record.clock_in_at) : now.getTime();
  const workedMinutes = Math.max(0, Math.round((now.getTime() - startMs) / 60_000));
  const standardMinutes = Math.round((rules.standard_hours_per_day || 8) * 60);
  const overtimeMinutes = Math.max(0, workedMinutes - standardMinutes);

  const updated: LocalPayrollAttendance = {
    ...record,
    clock_out_at: nowIso,
    worked_minutes: workedMinutes,
    overtime_minutes: overtimeMinutes,
    status: workedMinutes > 0 && workedMinutes < standardMinutes / 2 ? 'half_day' : 'present',
    recorded_by: actor.name,
    updated_at: nowIso,
    synced: 0,
  };
  await db.payroll_attendance.put(updated);
  void triggerPushSync('payroll-attendance');
  return updated;
}

export async function saveAttendanceRecord(
  storeId: string,
  input: {
    id?: string;
    staff_id: string;
    location_id: string | null;
    work_date: string;
    worked_minutes: number;
    overtime_minutes: number;
    status: PayrollAttendanceStatus;
    notes: string;
  },
  actor: PayrollActor
): Promise<LocalPayrollAttendance> {
  const now = new Date().toISOString();
  const existing = input.id ? await db.payroll_attendance.get(input.id) : undefined;
  const record: LocalPayrollAttendance = {
    id: existing?.id || generateId(),
    store_id: storeId,
    staff_id: input.staff_id,
    location_id: input.location_id,
    work_date: input.work_date || todayDateOnly(),
    clock_in_at: existing?.clock_in_at || null,
    clock_out_at: existing?.clock_out_at || null,
    worked_minutes: Math.max(0, Math.round(input.worked_minutes || 0)),
    overtime_minutes: Math.max(0, Math.round(input.overtime_minutes || 0)),
    status: input.status,
    notes: input.notes.trim(),
    recorded_by: actor.name,
    created_at: existing?.created_at || now,
    updated_at: now,
    synced: 0,
  };
  await db.payroll_attendance.put(record);
  await appendPayrollAudit({
    storeId,
    entityType: 'attendance',
    entityId: record.id,
    action: existing ? 'attendance_updated' : 'attendance_recorded',
    summary: `Saved attendance (${record.status}, ${(record.worked_minutes / 60).toFixed(1)}h, OT ${(record.overtime_minutes / 60).toFixed(1)}h) on ${record.work_date}.`,
    before: existing,
    after: record,
    actor,
  });
  void triggerPushSync('payroll-attendance');
  return record;
}

export async function deleteAttendanceRecord(storeId: string, id: string): Promise<void> {
  const existing = await db.payroll_attendance.get(id);
  if (!existing || existing.store_id !== storeId) return;
  await db.payroll_attendance.delete(id);
}

export interface MonthlyAttendanceSummary {
  hasLogs: boolean;
  daysWorked: number;
  shiftsWorked: number;
  workedMinutes: number;
  overtimeMinutes: number;
  absentDays: number;
}

export function summarizeMonthlyAttendance(
  logs: LocalPayrollAttendance[],
  staffId: string,
  payMonth: string
): MonthlyAttendanceSummary {
  const staffLogs = logs.filter((l) => l.staff_id === staffId && l.work_date.startsWith(payMonth));
  if (staffLogs.length === 0) {
    return {
      hasLogs: false,
      daysWorked: 0,
      shiftsWorked: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      absentDays: 0,
    };
  }

  let daysWorked = 0;
  let shiftsWorked = 0;
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let absentDays = 0;

  for (const log of staffLogs) {
    workedMinutes += Math.max(0, log.worked_minutes || 0);
    overtimeMinutes += Math.max(0, log.overtime_minutes || 0);
    if (log.status === 'present' || log.status === 'paid_leave') {
      daysWorked += 1;
      shiftsWorked += 1;
    } else if (log.status === 'half_day') {
      daysWorked += 0.5;
      shiftsWorked += 0.5;
      absentDays += 0.5;
    } else if (log.status === 'absent' || log.status === 'unpaid_leave') {
      absentDays += 1;
    }
  }

  return {
    hasLogs: true,
    daysWorked,
    shiftsWorked,
    workedMinutes,
    overtimeMinutes,
    absentDays,
  };
}

/* ================================================================== */
/*  Cashier Sales Commission (Read-Only from POS Transactions)        */
/* ================================================================== */

export async function getMonthlySalesByCashierPesewas(
  storeId: string,
  payMonth: string
): Promise<Map<string, number>> {
  const { periodStart, periodEnd } = getMonthPeriodBounds(payMonth);
  const txns = await db.transactions.where('store_id').equals(storeId).toArray();
  const totals = new Map<string, number>();

  for (const txn of txns) {
    if (!isCountedSale(txn)) continue;
    const dateOnly = (txn.created_at || '').slice(0, 10);
    if (dateOnly < periodStart || dateOnly > periodEnd) continue;
    const cashierId = txn.cashier_id;
    if (!cashierId) continue;
    const amountPesewas = ghsToPesewas(txn.total_amount || 0);
    totals.set(cashierId, (totals.get(cashierId) || 0) + amountPesewas);
  }

  return totals;
}

/* ================================================================== */
/*  Statutory Tax Settings & Store Payroll Rules                      */
/* ================================================================== */

export async function listTaxConfigs(storeId: string): Promise<LocalPayrollTaxConfig[]> {
  const { taxConfigs } = await ensurePayrollBootstrap(storeId);
  return taxConfigs;
}

export async function saveTaxConfig(
  storeId: string,
  input: Omit<LocalPayrollTaxConfig, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'> & { id?: string },
  actor: PayrollActor
): Promise<LocalPayrollTaxConfig> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from)) {
    throw new Error('Enter a valid effective date (YYYY-MM-DD).');
  }
  const bands = parsePayeBands(input.paye_bands_json);
  if (bands.length === 0) throw new Error('Add at least one PAYE tax band.');

  const now = new Date().toISOString();
  const existing = input.id ? await db.payroll_tax_configs.get(input.id) : undefined;
  const record: LocalPayrollTaxConfig = {
    ...input,
    id: existing?.id || generateId(),
    store_id: storeId,
    name: input.name.trim() || `Ghana Tax Rules (${input.effective_from})`,
    paye_bands_json: JSON.stringify(bands),
    tax_free_threshold_pesewas: Math.max(0, Math.round(input.tax_free_threshold_pesewas || 0)),
    ssnit_employee_rate_bps: Math.max(0, Math.round(input.ssnit_employee_rate_bps || 0)),
    ssnit_employer_rate_bps: Math.max(0, Math.round(input.ssnit_employer_rate_bps || 0)),
    ssnit_max_insurable_pesewas: Math.max(0, Math.round(input.ssnit_max_insurable_pesewas || 0)),
    ssnit_min_insurable_pesewas: Math.max(0, Math.round(input.ssnit_min_insurable_pesewas || 0)),
    created_at: existing?.created_at || now,
    updated_at: now,
    synced: 0,
  };

  await db.payroll_tax_configs.put(record);
  await appendPayrollAudit({
    storeId,
    entityType: 'tax_config',
    entityId: record.id,
    action: existing ? 'tax_rates_updated' : 'tax_rates_created',
    summary: `${existing ? 'Updated' : 'Added'} statutory PAYE/SSNIT schedule "${record.name}" effective ${record.effective_from} (SSNIT ${(record.ssnit_employee_rate_bps / 100).toFixed(2)}% / ${(record.ssnit_employer_rate_bps / 100).toFixed(2)}%, cap ${record.ssnit_max_insurable_pesewas > 0 ? formatPesewas(record.ssnit_max_insurable_pesewas) : 'Uncapped'}).`,
    before: existing,
    after: record,
    actor,
  });

  void triggerPushSync('payroll-tax-config');
  return record;
}

export async function markTaxConfigVerified(
  storeId: string,
  configId: string,
  actor: PayrollActor
): Promise<LocalPayrollTaxConfig> {
  const existing = await db.payroll_tax_configs.get(configId);
  if (!existing || existing.store_id !== storeId) throw new Error('Tax schedule not found.');
  const now = new Date().toISOString();
  const updated: LocalPayrollTaxConfig = {
    ...existing,
    verified_with_accountant: 1,
    verified_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.payroll_tax_configs.put(updated);
  await appendPayrollAudit({
    storeId,
    entityType: 'tax_config',
    entityId: configId,
    action: 'tax_rates_verified',
    summary: `Marked tax schedule "${existing.name}" as verified with accountant.`,
    before: existing,
    after: updated,
    actor,
  });
  void triggerPushSync('payroll-tax-config');
  return updated;
}

export async function savePayrollRules(
  storeId: string,
  patch: Partial<Omit<LocalPayrollRules, 'id' | 'store_id' | 'updated_at' | 'synced'>>,
  actor: PayrollActor
): Promise<LocalPayrollRules> {
  const { rules: existing } = await ensurePayrollBootstrap(storeId);
  const updated: LocalPayrollRules = {
    ...existing,
    ...patch,
    standard_hours_per_day: Math.max(1, Math.min(24, Number(patch.standard_hours_per_day ?? existing.standard_hours_per_day) || 8)),
    working_days_per_month: Math.max(1, Math.min(31, Math.round(Number(patch.working_days_per_month ?? existing.working_days_per_month) || 26))),
    overtime_multiplier_bps: Math.max(10_000, Math.round(Number(patch.overtime_multiplier_bps ?? existing.overtime_multiplier_bps) || 15_000)),
    filing_due_day: Math.max(1, Math.min(28, Math.round(Number(patch.filing_due_day ?? existing.filing_due_day) || 15))),
    updated_at: new Date().toISOString(),
    synced: 0,
  };
  await db.payroll_rules.put(updated);
  await appendPayrollAudit({
    storeId,
    entityType: 'rules',
    entityId: updated.id,
    action: 'payroll_rules_updated',
    summary: `Updated shop payroll rules (${updated.standard_hours_per_day}h/day, ${updated.working_days_per_month} days/month, OT ${(updated.overtime_multiplier_bps / 10_000).toFixed(2)}x, absence: ${updated.absence_deduction_mode}).`,
    before: existing,
    after: updated,
    actor,
  });
  void triggerPushSync('payroll-rules');
  return updated;
}

/* ================================================================== */
/*  Pay Runs: Calculate -> Review -> Approve -> Lock -> Adjustments   */
/* ================================================================== */

export async function listPayRuns(storeId: string): Promise<LocalPayrollRun[]> {
  const rows = await db.payroll_runs.where('store_id').equals(storeId).toArray();
  return rows.sort((a, b) => b.pay_month.localeCompare(a.pay_month) || b.created_at.localeCompare(a.created_at));
}

export async function getPayRunBundle(payRunId: string): Promise<{
  run: LocalPayrollRun;
  items: LocalPayrollRunItem[];
  adjustments: LocalPayrollAdjustment[];
} | null> {
  const run = await db.payroll_runs.get(payRunId);
  if (!run) return null;
  const [items, adjustments] = await Promise.all([
    db.payroll_run_items.where('pay_run_id').equals(payRunId).toArray(),
    db.payroll_adjustments.where('pay_run_id').equals(payRunId).toArray(),
  ]);
  items.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
  adjustments.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { run, items, adjustments };
}

function summarizeRunTotals(items: LocalPayrollRunItem[]) {
  return items.reduce(
    (acc, item) => ({
      staff_count: acc.staff_count + 1,
      total_gross_pesewas: acc.total_gross_pesewas + item.gross_pay_pesewas,
      total_ssnit_employee_pesewas: acc.total_ssnit_employee_pesewas + item.ssnit_employee_pesewas,
      total_ssnit_employer_pesewas: acc.total_ssnit_employer_pesewas + item.ssnit_employer_pesewas,
      total_paye_pesewas: acc.total_paye_pesewas + item.paye_pesewas,
      total_other_deductions_pesewas: acc.total_other_deductions_pesewas + item.total_other_deductions_pesewas,
      total_net_pesewas: acc.total_net_pesewas + item.net_pay_pesewas,
      total_employer_cost_pesewas: acc.total_employer_cost_pesewas + item.employer_cost_pesewas,
    }),
    {
      staff_count: 0,
      total_gross_pesewas: 0,
      total_ssnit_employee_pesewas: 0,
      total_ssnit_employer_pesewas: 0,
      total_paye_pesewas: 0,
      total_other_deductions_pesewas: 0,
      total_net_pesewas: 0,
      total_employer_cost_pesewas: 0,
    }
  );
}

/**
 * Create a new Draft pay run for payMonth (YYYY-MM) or recalculate an unlocked run
 * using latest active staff, attendance logs, POS cashier sales, loans/fines,
 * effective Ghana statutory tax settings, and store overtime/absence rules.
 */
export async function generateOrRecalculatePayRun(
  storeId: string,
  payMonth: string,
  actor: PayrollActor
): Promise<{ run: LocalPayrollRun; items: LocalPayrollRunItem[] }> {
  const existingRun = (await db.payroll_runs.where('store_id').equals(storeId).toArray())
    .find((r) => r.pay_month === payMonth);
  if (existingRun?.status === 'locked') {
    throw new Error(`Payroll for ${payMonth} is locked. Use "Log adjustment" to record any changes.`);
  }

  const [{ taxConfigs, rules }, staffList, deductions, attendance, locations, salesByCashier] = await Promise.all([
    ensurePayrollBootstrap(storeId),
    listPayrollStaff(storeId, false),
    listPayrollDeductions(storeId),
    listPayrollAttendance(storeId, payMonth),
    db.locations.where('store_id').equals(storeId).toArray(),
    getMonthlySalesByCashierPesewas(storeId, payMonth),
  ]);

  if (staffList.length === 0) {
    throw new Error('Add at least one active staff member before running payroll.');
  }

  const { periodStart, periodEnd } = getMonthPeriodBounds(payMonth);
  const effectiveTaxConfig = selectEffectiveTaxConfig(taxConfigs, periodEnd);
  if (!effectiveTaxConfig) {
    throw new Error('No statutory tax configuration found.');
  }
  const taxConfigInput = taxConfigToInput(effectiveTaxConfig);
  const locationMap = new Map<string, LocalLocation>(locations.map((l) => [l.id, l]));

  const existingItems = existingRun
    ? await db.payroll_run_items.where('pay_run_id').equals(existingRun.id).toArray()
    : [];
  const existingItemByStaff = new Map(existingItems.map((i) => [i.staff_id, i]));

  const now = new Date().toISOString();
  const runId = existingRun?.id || generateId();

  const items: LocalPayrollRunItem[] = staffList.map((staff) => {
    const prev = existingItemByStaff.get(staff.id);
    const att = summarizeMonthlyAttendance(attendance, staff.id, payMonth);
    const allowances = parseAllowances(staff.allowances_json);
    const staffDeductions = deductions.filter((d) => d.staff_id === staff.id);
    const salesTotalPesewas = staff.user_id ? (salesByCashier.get(staff.user_id) || 0) : 0;

    // If staff has attendance logs, use them; otherwise default to full working month (or previous manual edit).
    const daysWorked = att.hasLogs
      ? att.daysWorked
      : (prev ? prev.days_worked : rules.working_days_per_month);
    const shiftsWorked = att.hasLogs
      ? att.shiftsWorked
      : (prev ? prev.shifts_worked : rules.working_days_per_month);
    const workedMinutes = att.hasLogs
      ? att.workedMinutes
      : (prev ? prev.worked_minutes : Math.round(daysWorked * rules.standard_hours_per_day * 60));
    const overtimeMinutes = att.hasLogs ? att.overtimeMinutes : (prev?.overtime_minutes ?? 0);
    const absentDays = att.hasLogs ? att.absentDays : (prev?.absent_days ?? 0);
    const bonusPesewas = prev?.bonus_pesewas ?? 0;

    const calc = calculatePayslip({
      payType: staff.pay_type,
      basicRatePesewas: staff.basic_pay_pesewas,
      allowances,
      daysWorked,
      shiftsWorked,
      overtimeMinutes,
      absentDays,
      ssnitExempt: staff.ssnit_exempt === 1,
      commissionEnabled: staff.commission_enabled === 1,
      commissionRateBps: staff.commission_rate_bps,
      commissionMinSalesPesewas: staff.commission_min_sales_pesewas,
      salesTotalPesewas,
      bonusPesewas,
      activeDeductions: staffDeductions,
      payMonth,
      taxConfig: taxConfigInput,
      rules,
    });

    const loc = staff.location_id ? locationMap.get(staff.location_id) : undefined;
    return {
      id: prev?.id || generateId(),
      store_id: storeId,
      pay_run_id: runId,
      pay_month: payMonth,
      staff_id: staff.id,
      user_id: staff.user_id,
      staff_name: staff.full_name,
      role_title: staff.role_title,
      location_id: staff.location_id,
      location_name: loc?.name || 'Main Shop',
      pay_type: staff.pay_type,
      days_worked: daysWorked,
      shifts_worked: shiftsWorked,
      worked_minutes: workedMinutes,
      overtime_minutes: overtimeMinutes,
      absent_days: absentDays,
      basic_pay_pesewas: calc.basic_pay_pesewas,
      allowances_json: JSON.stringify(allowances),
      total_allowances_pesewas: calc.total_allowances_pesewas,
      overtime_pay_pesewas: calc.overtime_pay_pesewas,
      sales_total_pesewas: salesTotalPesewas,
      commission_pesewas: calc.commission_pesewas,
      bonus_pesewas: calc.bonus_pesewas,
      absence_deduction_pesewas: calc.absence_deduction_pesewas,
      gross_pay_pesewas: calc.gross_pay_pesewas,
      ssnit_pensionable_pesewas: calc.ssnit.pensionable_pesewas,
      ssnit_employee_pesewas: calc.ssnit.employee_pesewas,
      ssnit_employer_pesewas: calc.ssnit.employer_pesewas,
      chargeable_income_pesewas: calc.paye.chargeable_income_pesewas,
      paye_pesewas: calc.paye.tax_pesewas,
      paye_breakdown_json: JSON.stringify(calc.paye.slices),
      loan_deductions_json: JSON.stringify(calc.applied_deductions),
      total_other_deductions_pesewas: calc.total_other_deductions_pesewas,
      total_deductions_pesewas: calc.total_deductions_pesewas,
      net_pay_pesewas: calc.net_pay_pesewas,
      employer_cost_pesewas: calc.employer_cost_pesewas,
      payment_method: staff.payment_method,
      payment_destination: formatPaymentDestination(staff),
      payment_status: prev?.payment_status || 'unpaid',
      paid_at: prev?.paid_at || null,
      paid_by: prev?.paid_by || null,
      payment_reference: prev?.payment_reference || '',
      notes: prev?.notes || '',
      created_at: prev?.created_at || now,
      updated_at: now,
      synced: 0,
    };
  });

  const totals = summarizeRunTotals(items);
  const run: LocalPayrollRun = {
    id: runId,
    store_id: storeId,
    pay_month: payMonth,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'draft',
    tax_config_id: effectiveTaxConfig.id,
    tax_config_snapshot_json: JSON.stringify(effectiveTaxConfig),
    rules_snapshot_json: JSON.stringify(rules),
    ...totals,
    expense_entry_id: existingRun?.expense_entry_id || null,
    cash_book_entry_id: existingRun?.cash_book_entry_id || null,
    reviewed_by: null,
    reviewed_at: null,
    approved_by: null,
    approved_at: null,
    locked_by: null,
    locked_at: null,
    notes: existingRun?.notes || '',
    created_by: existingRun?.created_by || actor.name,
    created_at: existingRun?.created_at || now,
    updated_at: now,
    synced: 0,
  };

  await db.transaction('rw', [db.payroll_runs, db.payroll_run_items], async () => {
    await db.payroll_runs.put(run);
    // Remove items for staff who were deactivated since last draft
    const activeIds = new Set(items.map((i) => i.id));
    for (const prev of existingItems) {
      if (!activeIds.has(prev.id)) {
        await db.payroll_run_items.delete(prev.id);
      }
    }
    await db.payroll_run_items.bulkPut(items);
  });

  await appendPayrollAudit({
    storeId,
    entityType: 'pay_run',
    entityId: run.id,
    action: existingRun ? 'pay_run_recalculated' : 'pay_run_created',
    summary: `${existingRun ? 'Recalculated' : 'Calculated'} ${payMonth} pay run for ${run.staff_count} staff (Net ${formatPesewas(run.total_net_pesewas)}, Employer cost ${formatPesewas(run.total_employer_cost_pesewas)}).`,
    after: { pay_month: run.pay_month, staff_count: run.staff_count, total_net_pesewas: run.total_net_pesewas },
    actor,
  });

  void triggerPushSync('payroll-run');
  return { run, items };
}

/**
 * Edit an individual staff member's inputs (days/shifts, overtime minutes, absent days, bonus, notes)
 * while the pay run is still unlocked (draft/reviewed/approved).
 */
export async function updateUnlockedRunItem(
  storeId: string,
  runItemId: string,
  patch: {
    days_worked?: number;
    shifts_worked?: number;
    overtime_minutes?: number;
    absent_days?: number;
    bonus_pesewas?: number;
    notes?: string;
  },
  actor: PayrollActor
): Promise<LocalPayrollRunItem> {
  const item = await db.payroll_run_items.get(runItemId);
  if (!item || item.store_id !== storeId) throw new Error('Payslip item not found.');
  const run = await db.payroll_runs.get(item.pay_run_id);
  if (!run) throw new Error('Pay run not found.');
  if (run.status === 'locked') {
    throw new Error('This month is locked. Use "Log adjustment" instead of editing payslips directly.');
  }

  const staff = await db.payroll_staff.get(item.staff_id);
  if (!staff) throw new Error('Staff record not found.');
  const taxConfigSnapshot: LocalPayrollTaxConfig = JSON.parse(run.tax_config_snapshot_json);
  const rulesSnapshot: LocalPayrollRules = JSON.parse(run.rules_snapshot_json);
  const deductions = await db.payroll_deductions
    .where('store_id').equals(storeId)
    .and((d) => d.staff_id === staff.id)
    .toArray();

  const daysWorked = patch.days_worked ?? item.days_worked;
  const shiftsWorked = patch.shifts_worked ?? item.shifts_worked;
  const overtimeMinutes = Math.max(0, Math.round(patch.overtime_minutes ?? item.overtime_minutes));
  const absentDays = Math.max(0, patch.absent_days ?? item.absent_days);
  const bonusPesewas = Math.max(0, Math.round(patch.bonus_pesewas ?? item.bonus_pesewas));

  const calc = calculatePayslip({
    payType: staff.pay_type,
    basicRatePesewas: staff.basic_pay_pesewas,
    allowances: parseAllowances(item.allowances_json),
    daysWorked,
    shiftsWorked,
    overtimeMinutes,
    absentDays,
    ssnitExempt: staff.ssnit_exempt === 1,
    commissionEnabled: staff.commission_enabled === 1,
    commissionRateBps: staff.commission_rate_bps,
    commissionMinSalesPesewas: staff.commission_min_sales_pesewas,
    salesTotalPesewas: item.sales_total_pesewas,
    bonusPesewas,
    activeDeductions: deductions,
    payMonth: run.pay_month,
    taxConfig: taxConfigToInput(taxConfigSnapshot),
    rules: rulesSnapshot,
  });

  const now = new Date().toISOString();
  const updated: LocalPayrollRunItem = {
    ...item,
    days_worked: daysWorked,
    shifts_worked: shiftsWorked,
    overtime_minutes: overtimeMinutes,
    absent_days: absentDays,
    basic_pay_pesewas: calc.basic_pay_pesewas,
    overtime_pay_pesewas: calc.overtime_pay_pesewas,
    commission_pesewas: calc.commission_pesewas,
    bonus_pesewas: calc.bonus_pesewas,
    absence_deduction_pesewas: calc.absence_deduction_pesewas,
    gross_pay_pesewas: calc.gross_pay_pesewas,
    ssnit_pensionable_pesewas: calc.ssnit.pensionable_pesewas,
    ssnit_employee_pesewas: calc.ssnit.employee_pesewas,
    ssnit_employer_pesewas: calc.ssnit.employer_pesewas,
    chargeable_income_pesewas: calc.paye.chargeable_income_pesewas,
    paye_pesewas: calc.paye.tax_pesewas,
    paye_breakdown_json: JSON.stringify(calc.paye.slices),
    loan_deductions_json: JSON.stringify(calc.applied_deductions),
    total_other_deductions_pesewas: calc.total_other_deductions_pesewas,
    total_deductions_pesewas: calc.total_deductions_pesewas,
    net_pay_pesewas: calc.net_pay_pesewas,
    employer_cost_pesewas: calc.employer_cost_pesewas,
    notes: patch.notes !== undefined ? patch.notes.trim() : item.notes,
    updated_at: now,
    synced: 0,
  };

  await db.transaction('rw', [db.payroll_runs, db.payroll_run_items], async () => {
    await db.payroll_run_items.put(updated);
    const allItems = await db.payroll_run_items.where('pay_run_id').equals(run.id).toArray();
    const totals = summarizeRunTotals(allItems);
    await db.payroll_runs.update(run.id, {
      ...totals,
      status: 'draft', // Return to draft after any edit so it must be reviewed & approved again
      updated_at: now,
      synced: 0,
    });
  });

  await appendPayrollAudit({
    storeId,
    entityType: 'pay_run',
    entityId: run.id,
    action: 'pay_run_item_edited',
    summary: `Adjusted ${item.staff_name} in ${run.pay_month} pay run (Net ${formatPesewas(item.net_pay_pesewas)} -> ${formatPesewas(updated.net_pay_pesewas)}).`,
    before: { bonus_pesewas: item.bonus_pesewas, overtime_minutes: item.overtime_minutes, absent_days: item.absent_days, net_pay_pesewas: item.net_pay_pesewas },
    after: { bonus_pesewas: updated.bonus_pesewas, overtime_minutes: updated.overtime_minutes, absent_days: updated.absent_days, net_pay_pesewas: updated.net_pay_pesewas },
    actor,
  });

  void triggerPushSync('payroll-run-edit');
  return updated;
}

export async function advancePayRunStatus(
  storeId: string,
  payRunId: string,
  targetStatus: 'reviewed' | 'approved',
  actor: PayrollActor
): Promise<LocalPayrollRun> {
  const run = await db.payroll_runs.get(payRunId);
  if (!run || run.store_id !== storeId) throw new Error('Pay run not found.');
  if (run.status === 'locked') throw new Error('Pay run is already locked.');

  const now = new Date().toISOString();
  const patch: Partial<LocalPayrollRun> = {
    status: targetStatus,
    updated_at: now,
    synced: 0,
  };
  if (targetStatus === 'reviewed') {
    patch.reviewed_by = actor.name;
    patch.reviewed_at = now;
  } else if (targetStatus === 'approved') {
    patch.reviewed_by = run.reviewed_by || actor.name;
    patch.reviewed_at = run.reviewed_at || now;
    patch.approved_by = actor.name;
    patch.approved_at = now;
  }

  await db.payroll_runs.update(payRunId, patch);
  const updated = (await db.payroll_runs.get(payRunId))!;
  await appendPayrollAudit({
    storeId,
    entityType: 'pay_run',
    entityId: payRunId,
    action: targetStatus === 'reviewed' ? 'pay_run_reviewed' : 'pay_run_approved',
    summary: `${targetStatus === 'reviewed' ? 'Reviewed' : 'Approved'} ${run.pay_month} pay run (${run.staff_count} staff, Net ${formatPesewas(run.total_net_pesewas)}).`,
    actor,
  });
  void triggerPushSync('payroll-status');
  return updated;
}

/**
 * Lock an approved pay run:
 * 1. Marks the month permanently locked (future changes require a logged adjustment).
 * 2. Commits all scheduled loan/advance/fine repayments and updates remaining balances.
 * 3. Posts salaries to Expense Reports (db.expenses) and Cash Book (db.cash_book_entries)
 *    using deterministic IDs so profit figures and cash flow include wages without duplicates.
 */
export async function lockPayRun(
  storeId: string,
  payRunId: string,
  options: {
    postToExpenses: boolean;
    postToCashBook: boolean;
  },
  actor: PayrollActor
): Promise<LocalPayrollRun> {
  const run = await db.payroll_runs.get(payRunId);
  if (!run || run.store_id !== storeId) throw new Error('Pay run not found.');
  if (run.status === 'locked') return run;
  if (run.status !== 'approved') {
    throw new Error('Approve the pay run before locking the month.');
  }

  const items = await db.payroll_run_items.where('pay_run_id').equals(payRunId).toArray();
  const now = new Date().toISOString();
  const entryDate = run.period_end;

  const employerCostGhs = pesewasToGhs(run.total_employer_cost_pesewas);
  const primaryMethod: 'cash' | 'momo' | 'bank' = (() => {
    const counts = { momo: 0, bank: 0, cash: 0 };
    items.forEach((i) => { counts[i.payment_method] += 1; });
    if (counts.momo >= counts.bank && counts.momo >= counts.cash) return 'momo';
    if (counts.bank >= counts.cash) return 'bank';
    return 'cash';
  })();

  const expenseId = options.postToExpenses && employerCostGhs > 0
    ? stableUuid(`payroll:expense:${storeId}:${payRunId}`)
    : null;
  const cashBookId = options.postToCashBook && employerCostGhs > 0
    ? stableUuid(`payroll:cashbook:${storeId}:${payRunId}`)
    : null;

  const notesText = [
    `Payroll ${run.pay_month} (${run.staff_count} staff)`,
    `Gross: ${formatPesewas(run.total_gross_pesewas)}`,
    `Employer SSNIT: ${formatPesewas(run.total_ssnit_employer_pesewas)}`,
    `Employee SSNIT: ${formatPesewas(run.total_ssnit_employee_pesewas)}`,
    `PAYE: ${formatPesewas(run.total_paye_pesewas)}`,
    `Net pay: ${formatPesewas(run.total_net_pesewas)}`,
  ].join(' · ');

  await db.transaction(
    'rw',
    [db.payroll_runs, db.payroll_deductions, db.payroll_deduction_repayments, db.expenses, db.cash_book_entries],
    async () => {
      // 1. Apply loan/advance/fine repayments
      for (const item of items) {
        let applied: AppliedLoanDeduction[] = [];
        try {
          applied = JSON.parse(item.loan_deductions_json || '[]');
        } catch {
          applied = [];
        }
        for (const ded of applied) {
          if (ded.applied_pesewas <= 0) continue;
          const record = await db.payroll_deductions.get(ded.deduction_id);
          if (!record) continue;
          const nextBalance = Math.max(0, record.remaining_balance_pesewas - ded.applied_pesewas);
          const repaymentId = stableUuid(`payroll:repay:${payRunId}:${ded.deduction_id}`);
          const repayment: LocalPayrollDeductionRepayment = {
            id: repaymentId,
            store_id: storeId,
            deduction_id: record.id,
            staff_id: item.staff_id,
            pay_run_id: payRunId,
            pay_month: run.pay_month,
            amount_pesewas: ded.applied_pesewas,
            balance_after_pesewas: nextBalance,
            created_at: now,
            synced: 0,
          };
          await db.payroll_deduction_repayments.put(repayment);
          await db.payroll_deductions.update(record.id, {
            remaining_balance_pesewas: nextBalance,
            status: nextBalance <= 0 ? 'paid_off' : record.status,
            updated_at: now,
            synced: 0,
          });
        }
      }

      // 2. Post to Expense Reports (so Reports net profit includes wages)
      if (expenseId) {
        const expenseRow: LocalExpense = {
          id: expenseId,
          store_id: storeId,
          description: `Staff Payroll — ${run.pay_month} (${run.staff_count} staff)`,
          category: 'Salaries',
          amount: employerCostGhs,
          notes: notesText,
          expense_date: entryDate,
          payment_method: primaryMethod,
          created_at: now,
          updated_at: now,
          synced: 0,
        };
        await db.expenses.put(expenseRow);
      }

      // 3. Post to Cash Book (so Cash Flow ledger includes salaries)
      if (cashBookId) {
        const cashBookRow: LocalCashBookEntry = {
          id: cashBookId,
          store_id: storeId,
          entry_type: 'expense',
          description: `Staff Payroll — ${run.pay_month} (${run.staff_count} staff)`,
          category: 'Salaries',
          amount: employerCostGhs,
          notes: notesText,
          entry_date: entryDate,
          created_by: actor.name,
          created_at: now,
          updated_at: now,
          synced: 0,
          account_type: primaryMethod === 'cash' ? 'cash' : 'bank',
        };
        await db.cash_book_entries.put(cashBookRow);
      }

      // 4. Lock pay run
      await db.payroll_runs.update(payRunId, {
        status: 'locked',
        locked_by: actor.name,
        locked_at: now,
        expense_entry_id: expenseId,
        cash_book_entry_id: cashBookId,
        updated_at: now,
        synced: 0,
      });
    }
  );

  const locked = (await db.payroll_runs.get(payRunId))!;
  await appendPayrollAudit({
    storeId,
    entityType: 'pay_run',
    entityId: payRunId,
    action: 'pay_run_locked',
    summary: `Locked ${run.pay_month} payroll (${run.staff_count} staff, Employer cost ${formatPesewas(run.total_employer_cost_pesewas)}). Posted to ${[expenseId ? 'Expenses' : '', cashBookId ? 'Cash Book' : ''].filter(Boolean).join(' & ') || 'Payroll only'}.`,
    after: { expense_entry_id: expenseId, cash_book_entry_id: cashBookId, total_employer_cost_pesewas: run.total_employer_cost_pesewas },
    actor,
  });

  void triggerPushSync('payroll-lock');
  return locked;
}

/**
 * Locked months can ONLY be modified via an explicit, immutable logged adjustment.
 */
export async function addLockedPayRunAdjustment(
  storeId: string,
  input: {
    pay_run_id: string;
    run_item_id: string;
    adjustment_type: PayrollAdjustmentType;
    delta_net_pesewas: number;
    reason: string;
  },
  actor: PayrollActor
): Promise<LocalPayrollAdjustment> {
  const run = await db.payroll_runs.get(input.pay_run_id);
  if (!run || run.store_id !== storeId) throw new Error('Pay run not found.');
  if (run.status !== 'locked') throw new Error('Only locked pay runs use logged adjustments.');
  const item = await db.payroll_run_items.get(input.run_item_id);
  if (!item || item.pay_run_id !== run.id) throw new Error('Staff payslip not found in this pay run.');
  const reason = input.reason.trim();
  if (!reason) throw new Error('Enter a clear reason for this locked-month adjustment.');
  const delta = Math.round(input.delta_net_pesewas);
  if (delta === 0) throw new Error('Adjustment amount cannot be zero.');

  const now = new Date().toISOString();
  const adjustment: LocalPayrollAdjustment = {
    id: generateId(),
    store_id: storeId,
    pay_run_id: run.id,
    run_item_id: item.id,
    staff_id: item.staff_id,
    staff_name: item.staff_name,
    pay_month: run.pay_month,
    adjustment_type: input.adjustment_type,
    delta_net_pesewas: delta,
    delta_employer_cost_pesewas: delta,
    reason,
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: now,
    synced: 0,
  };

  await db.payroll_adjustments.add(adjustment);

  // If adjustment increases cost and the run was posted to expenses/cash book, post an adjustment entry
  if (delta > 0) {
    const amountGhs = pesewasToGhs(delta);
    const desc = `Payroll Adjustment (${run.pay_month}) — ${item.staff_name}`;
    if (run.expense_entry_id) {
      await db.expenses.put({
        id: stableUuid(`payroll:adj-exp:${adjustment.id}`),
        store_id: storeId,
        description: desc,
        category: 'Salaries',
        amount: amountGhs,
        notes: `${input.adjustment_type}: ${reason}`,
        expense_date: todayDateOnly(),
        payment_method: item.payment_method,
        created_at: now,
        updated_at: now,
        synced: 0,
      });
    }
    if (run.cash_book_entry_id) {
      await db.cash_book_entries.put({
        id: stableUuid(`payroll:adj-cb:${adjustment.id}`),
        store_id: storeId,
        entry_type: 'expense',
        description: desc,
        category: 'Salaries',
        amount: amountGhs,
        notes: `${input.adjustment_type}: ${reason}`,
        entry_date: todayDateOnly(),
        created_by: actor.name,
        created_at: now,
        updated_at: now,
        synced: 0,
        account_type: item.payment_method === 'cash' ? 'cash' : 'bank',
      });
    }
  }

  await appendPayrollAudit({
    storeId,
    entityType: 'adjustment',
    entityId: adjustment.id,
    action: 'locked_adjustment_logged',
    summary: `Logged ${input.adjustment_type} of ${delta > 0 ? '+' : ''}${formatPesewas(delta)} for ${item.staff_name} on locked ${run.pay_month} payroll: ${reason}`,
    after: adjustment,
    actor,
  });

  void triggerPushSync('payroll-adjustment');
  return adjustment;
}

export async function markRunItemPaymentStatus(
  storeId: string,
  runItemId: string,
  status: 'paid' | 'unpaid',
  paymentReference: string,
  actor: PayrollActor
): Promise<LocalPayrollRunItem> {
  const item = await db.payroll_run_items.get(runItemId);
  if (!item || item.store_id !== storeId) throw new Error('Payment item not found.');
  const now = new Date().toISOString();
  const updated: LocalPayrollRunItem = {
    ...item,
    payment_status: status,
    paid_at: status === 'paid' ? now : null,
    paid_by: status === 'paid' ? actor.name : null,
    payment_reference: status === 'paid' ? paymentReference.trim() : '',
    updated_at: now,
    synced: 0,
  };
  await db.payroll_run_items.put(updated);
  await appendPayrollAudit({
    storeId,
    entityType: 'payment',
    entityId: item.id,
    action: status === 'paid' ? 'payment_marked_paid' : 'payment_marked_unpaid',
    summary: `Marked ${item.staff_name} (${item.pay_month}, ${formatPesewas(item.net_pay_pesewas)} via ${item.payment_method.toUpperCase()}) as ${status}${paymentReference.trim() ? ` (Ref: ${paymentReference.trim()})` : ''}.`,
    actor,
  });
  void triggerPushSync('payroll-payment');
  return updated;
}

/* ================================================================== */
/*  Cashier Self-Service Payslips                                     */
/* ================================================================== */

export async function listPayslipsForCashierUser(
  storeId: string,
  userId: string
): Promise<Array<{ item: LocalPayrollRunItem; runStatus: LocalPayrollRun['status']; adjustments: LocalPayrollAdjustment[] }>> {
  const staff = await getPayrollStaffForUser(storeId, userId);
  const [allItems, allRuns, allAdjustments] = await Promise.all([
    db.payroll_run_items.where('store_id').equals(storeId).toArray(),
    db.payroll_runs.where('store_id').equals(storeId).toArray(),
    db.payroll_adjustments.where('store_id').equals(storeId).toArray(),
  ]);
  const runMap = new Map(allRuns.map((r) => [r.id, r]));

  // Only show approved or locked payslips belonging strictly to this cashier
  const ownItems = allItems.filter((item) => {
    const belongs = item.user_id === userId || (staff && item.staff_id === staff.id);
    if (!belongs) return false;
    const run = runMap.get(item.pay_run_id);
    return run && (run.status === 'approved' || run.status === 'locked');
  });

  ownItems.sort((a, b) => b.pay_month.localeCompare(a.pay_month));
  return ownItems.map((item) => ({
    item,
    runStatus: runMap.get(item.pay_run_id)!.status,
    adjustments: allAdjustments.filter((a) => a.run_item_id === item.id),
  }));
}

/* ================================================================== */
/*  Compliance, Shop Cost Breakdown, Year-End & Audit Trail           */
/* ================================================================== */

export interface MonthlyComplianceSummary {
  payMonth: string;
  dueDate: string;
  status: LocalPayrollRun['status'];
  staffCount: number;
  totalGrossPesewas: number;
  totalSsnitEmployeePesewas: number;
  totalSsnitEmployerPesewas: number;
  totalSsnitRemittancePesewas: number;
  totalPayeRemittancePesewas: number;
  totalNetPesewas: number;
  totalEmployerCostPesewas: number;
  taxVerified: boolean;
  staffLines: Array<{
    staffId: string;
    staffName: string;
    ssnitNumber: string;
    tinNumber: string;
    locationName: string;
    grossPesewas: number;
    pensionablePesewas: number;
    ssnitEmployeePesewas: number;
    ssnitEmployerPesewas: number;
    chargeableIncomePesewas: number;
    payePesewas: number;
    netPayPesewas: number;
    employerCostPesewas: number;
  }>;
}

export async function buildMonthlyComplianceSummary(
  storeId: string,
  payMonth: string
): Promise<MonthlyComplianceSummary | null> {
  const runs = await db.payroll_runs.where('store_id').equals(storeId).toArray();
  const run = runs.find((r) => r.pay_month === payMonth);
  if (!run) return null;

  const [items, staffList, { rules }] = await Promise.all([
    db.payroll_run_items.where('pay_run_id').equals(run.id).toArray(),
    listPayrollStaff(storeId, true),
    ensurePayrollBootstrap(storeId),
  ]);
  const staffMap = new Map(staffList.map((s) => [s.id, s]));
  items.sort((a, b) => a.staff_name.localeCompare(b.staff_name));

  let taxVerified = false;
  try {
    const snap = JSON.parse(run.tax_config_snapshot_json) as LocalPayrollTaxConfig;
    taxVerified = snap.verified_with_accountant === 1;
  } catch {
    taxVerified = false;
  }

  return {
    payMonth: run.pay_month,
    dueDate: getStatutoryFilingDueDate(run.pay_month, rules.filing_due_day),
    status: run.status,
    staffCount: run.staff_count,
    totalGrossPesewas: run.total_gross_pesewas,
    totalSsnitEmployeePesewas: run.total_ssnit_employee_pesewas,
    totalSsnitEmployerPesewas: run.total_ssnit_employer_pesewas,
    totalSsnitRemittancePesewas: run.total_ssnit_employee_pesewas + run.total_ssnit_employer_pesewas,
    totalPayeRemittancePesewas: run.total_paye_pesewas,
    totalNetPesewas: run.total_net_pesewas,
    totalEmployerCostPesewas: run.total_employer_cost_pesewas,
    taxVerified,
    staffLines: items.map((item) => {
      const s = staffMap.get(item.staff_id);
      return {
        staffId: item.staff_id,
        staffName: item.staff_name,
        ssnitNumber: s?.ssnit_number || '',
        tinNumber: s?.tin_number || '',
        locationName: item.location_name || 'Main Shop',
        grossPesewas: item.gross_pay_pesewas,
        pensionablePesewas: item.ssnit_pensionable_pesewas,
        ssnitEmployeePesewas: item.ssnit_employee_pesewas,
        ssnitEmployerPesewas: item.ssnit_employer_pesewas,
        chargeableIncomePesewas: item.chargeable_income_pesewas,
        payePesewas: item.paye_pesewas,
        netPayPesewas: item.net_pay_pesewas,
        employerCostPesewas: item.employer_cost_pesewas,
      };
    }),
  };
}

export interface ShopCostRow {
  locationId: string;
  locationName: string;
  staffCount: number;
  grossPesewas: number;
  employerSsnitPesewas: number;
  employerCostPesewas: number;
  netPayPesewas: number;
}

export async function buildShopCostBreakdown(
  storeId: string,
  payMonth: string
): Promise<ShopCostRow[]> {
  const runs = await db.payroll_runs.where('store_id').equals(storeId).toArray();
  const run = runs.find((r) => r.pay_month === payMonth);
  if (!run) return [];

  const [items, adjustments] = await Promise.all([
    db.payroll_run_items.where('pay_run_id').equals(run.id).toArray(),
    db.payroll_adjustments.where('pay_run_id').equals(run.id).toArray(),
  ]);

  const adjByItem = new Map<string, number>();
  for (const adj of adjustments) {
    adjByItem.set(adj.run_item_id, (adjByItem.get(adj.run_item_id) || 0) + adj.delta_employer_cost_pesewas);
  }

  const byLoc = new Map<string, ShopCostRow>();
  for (const item of items) {
    const key = item.location_id || 'main';
    const name = item.location_name || 'Main Shop';
    const adjDelta = adjByItem.get(item.id) || 0;
    const prev = byLoc.get(key) || {
      locationId: key,
      locationName: name,
      staffCount: 0,
      grossPesewas: 0,
      employerSsnitPesewas: 0,
      employerCostPesewas: 0,
      netPayPesewas: 0,
    };
    prev.staffCount += 1;
    prev.grossPesewas += item.gross_pay_pesewas;
    prev.employerSsnitPesewas += item.ssnit_employer_pesewas;
    prev.employerCostPesewas += item.employer_cost_pesewas + adjDelta;
    prev.netPayPesewas += item.net_pay_pesewas + adjDelta;
    byLoc.set(key, prev);
  }

  return [...byLoc.values()].sort((a, b) => b.employerCostPesewas - a.employerCostPesewas);
}

export interface YearEndStaffRow {
  staffId: string;
  staffName: string;
  roleTitle: string;
  ssnitNumber: string;
  tinNumber: string;
  monthsPaid: number;
  totalBasicPesewas: number;
  totalAllowancesPesewas: number;
  totalOvertimeCommissionBonusPesewas: number;
  totalGrossPesewas: number;
  totalSsnitEmployeePesewas: number;
  totalSsnitEmployerPesewas: number;
  totalPayePesewas: number;
  totalOtherDeductionsPesewas: number;
  totalAdjustmentsPesewas: number;
  totalNetPesewas: number;
  totalEmployerCostPesewas: number;
}

export async function buildYearEndStaffReport(
  storeId: string,
  year: number
): Promise<YearEndStaffRow[]> {
  const prefix = `${year}-`;
  const [runs, items, adjustments, staffList] = await Promise.all([
    db.payroll_runs.where('store_id').equals(storeId).toArray(),
    db.payroll_run_items.where('store_id').equals(storeId).toArray(),
    db.payroll_adjustments.where('store_id').equals(storeId).toArray(),
    listPayrollStaff(storeId, true),
  ]);

  const includedRunIds = new Set(
    runs.filter((r) => r.pay_month.startsWith(prefix) && (r.status === 'approved' || r.status === 'locked')).map((r) => r.id)
  );
  const staffMap = new Map(staffList.map((s) => [s.id, s]));

  const byStaff = new Map<string, YearEndStaffRow>();
  for (const item of items) {
    if (!includedRunIds.has(item.pay_run_id)) continue;
    const s = staffMap.get(item.staff_id);
    const row = byStaff.get(item.staff_id) || {
      staffId: item.staff_id,
      staffName: s?.full_name || item.staff_name,
      roleTitle: s?.role_title || item.role_title,
      ssnitNumber: s?.ssnit_number || '',
      tinNumber: s?.tin_number || '',
      monthsPaid: 0,
      totalBasicPesewas: 0,
      totalAllowancesPesewas: 0,
      totalOvertimeCommissionBonusPesewas: 0,
      totalGrossPesewas: 0,
      totalSsnitEmployeePesewas: 0,
      totalSsnitEmployerPesewas: 0,
      totalPayePesewas: 0,
      totalOtherDeductionsPesewas: 0,
      totalAdjustmentsPesewas: 0,
      totalNetPesewas: 0,
      totalEmployerCostPesewas: 0,
    };
    row.monthsPaid += 1;
    row.totalBasicPesewas += item.basic_pay_pesewas;
    row.totalAllowancesPesewas += item.total_allowances_pesewas;
    row.totalOvertimeCommissionBonusPesewas += item.overtime_pay_pesewas + item.commission_pesewas + item.bonus_pesewas;
    row.totalGrossPesewas += item.gross_pay_pesewas;
    row.totalSsnitEmployeePesewas += item.ssnit_employee_pesewas;
    row.totalSsnitEmployerPesewas += item.ssnit_employer_pesewas;
    row.totalPayePesewas += item.paye_pesewas;
    row.totalOtherDeductionsPesewas += item.total_other_deductions_pesewas;
    row.totalNetPesewas += item.net_pay_pesewas;
    row.totalEmployerCostPesewas += item.employer_cost_pesewas;
    byStaff.set(item.staff_id, row);
  }

  for (const adj of adjustments) {
    if (!includedRunIds.has(adj.pay_run_id)) continue;
    const row = byStaff.get(adj.staff_id);
    if (!row) continue;
    row.totalAdjustmentsPesewas += adj.delta_net_pesewas;
    row.totalNetPesewas += adj.delta_net_pesewas;
    row.totalEmployerCostPesewas += adj.delta_employer_cost_pesewas;
  }

  return [...byStaff.values()].sort((a, b) => a.staffName.localeCompare(b.staffName));
}

export async function listPayrollAuditLogs(storeId: string, limit = 150): Promise<LocalPayrollAuditLog[]> {
  const rows = await db.payroll_audit_logs.where('store_id').equals(storeId).toArray();
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.slice(0, limit);
}

import { db } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { generateId } from '@/lib/dexie';
import type {
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
} from './types';

function missingTable(message: string): boolean {
  return /does not exist|PGRST205|schema cache|permission denied|42501/i.test(message);
}

function stripSynced<T extends { synced: number }>(row: T): Record<string, unknown> {
  const { synced: _synced, ...rest } = row;
  return rest as Record<string, unknown>;
}

const RUN_STATUS_RANK: Record<LocalPayrollRun['status'], number> = {
  draft: 0,
  reviewed: 1,
  approved: 2,
  locked: 3,
};

async function upsertPayrollTable<T extends { id: string; store_id: string; synced: number }>(
  label: string,
  tableName: string,
  rows: T[],
  markSynced: (ids: string[]) => Promise<void>,
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await supabase
    .from(tableName)
    .upsert(rows.map(stripSynced), { onConflict: 'id' });
  if (error) {
    if (!missingTable(error.message || '')) {
      errors.push(`${label}: ${error.message}`);
    }
    return 0;
  }
  await markSynced(rows.map((r) => r.id));
  return rows.length;
}

/**
 * Push unsynced local payroll records to Supabase.
 * Safe to call when Supabase payroll tables are not yet provisioned (no-ops cleanly).
 */
export async function pushPayrollRecords(storeId: string): Promise<{ synced: number; error: string }> {
  if (!isSupabaseConfigured() || !storeId) return { synced: 0, error: '' };
  const errors: string[] = [];
  let synced = 0;

  const [
    staff,
    deductions,
    repayments,
    attendance,
    taxConfigs,
    rules,
    runs,
    runItems,
    adjustments,
    auditLogs,
  ] = await Promise.all([
    db.payroll_staff.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_deductions.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_deduction_repayments.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_attendance.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_tax_configs.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_rules.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_runs.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_run_items.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_adjustments.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
    db.payroll_audit_logs.where('store_id').equals(storeId).and((r) => r.synced === 0).toArray(),
  ]);

  synced += await upsertPayrollTable('Payroll staff', 'payroll_staff', staff, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_staff.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll deductions', 'payroll_deductions', deductions, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_deductions.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll repayments', 'payroll_deduction_repayments', repayments, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_deduction_repayments.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll attendance', 'payroll_attendance', attendance, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_attendance.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll tax configs', 'payroll_tax_configs', taxConfigs, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_tax_configs.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll rules', 'payroll_rules', rules, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_rules.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll runs', 'payroll_runs', runs, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_runs.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll run items', 'payroll_run_items', runItems, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_run_items.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll adjustments', 'payroll_adjustments', adjustments, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_adjustments.update(id, { synced: 1 })));
  }, errors);

  synced += await upsertPayrollTable('Payroll audit logs', 'payroll_audit_logs', auditLogs, async (ids) => {
    await Promise.all(ids.map((id) => db.payroll_audit_logs.update(id, { synced: 1 })));
  }, errors);

  return { synced, error: errors.join('; ') };
}

/**
 * Resolve conflict between an unsynced local mutable row and a remote row:
 * - If local is already synced (synced === 1), remote always updates local.
 * - If local has unsynced edits (synced === 0):
 *     - Compare updated_at timestamps (last-write-wins).
 *     - If remote is strictly newer, accept remote and record a conflict audit note.
 *     - If local is newer or equal, keep local unsynced so the next push wins.
 */
async function mergeMutableRow<T extends { id: string; store_id: string; updated_at: string; synced: number }>(
  table: {
    get: (id: string) => Promise<T | undefined>;
    put: (row: T) => Promise<string>;
  },
  remoteRow: T,
  entityType: LocalPayrollAuditLog['entity_type'],
  label: string
): Promise<boolean> {
  const local = await table.get(remoteRow.id);
  if (!local) {
    await table.put({ ...remoteRow, synced: 1 });
    return true;
  }
  if (local.synced === 0) {
    if ((remoteRow.updated_at || '') > (local.updated_at || '')) {
      await table.put({ ...remoteRow, synced: 1 });
      await db.payroll_audit_logs.add({
        id: generateId(),
        store_id: remoteRow.store_id,
        entity_type: entityType,
        entity_id: remoteRow.id,
        action: 'sync_conflict_resolved',
        summary: `Cloud sync resolved a newer update for ${label}; local unsynced version archived in audit log.`,
        before_json: JSON.stringify(local),
        after_json: JSON.stringify(remoteRow),
        actor_id: 'sync',
        actor_name: 'Cloud Sync',
        created_at: new Date().toISOString(),
        synced: 0,
      });
      return true;
    }
    return false;
  }
  if ((remoteRow.updated_at || '') >= (local.updated_at || '')) {
    await table.put({ ...remoteRow, synced: 1 });
  }
  return false;
}

/**
 * Pull payroll records from Supabase into Dexie with conflict handling.
 * Locked pay runs are protected from stale drafts across devices.
 */
export async function pullPayrollRecords(storeId: string): Promise<number> {
  if (!isSupabaseConfigured() || !storeId) return 0;
  let pulled = 0;

  const pullTable = async <T>(tableName: string): Promise<T[] | null> => {
    const { data, error } = await supabase.from(tableName).select('*').eq('store_id', storeId);
    if (error) {
      if (missingTable(error.message || '')) return null;
      throw new Error(`${tableName}: ${error.message}`);
    }
    return ((data || []) as unknown) as T[];
  };

  const staffRows = await pullTable<LocalPayrollStaff>('payroll_staff');
  if (!staffRows) return 0; // Migration not applied on cloud yet; skip silently.
  for (const row of staffRows) {
    if (await mergeMutableRow(db.payroll_staff, { ...row, synced: 1 }, 'staff', row.full_name || 'staff record')) {
      pulled += 1;
    }
  }

  const deductionRows = await pullTable<LocalPayrollDeduction>('payroll_deductions');
  for (const row of deductionRows || []) {
    if (await mergeMutableRow(db.payroll_deductions, { ...row, synced: 1 }, 'deduction', row.reason || 'deduction')) {
      pulled += 1;
    }
  }

  const repaymentRows = await pullTable<LocalPayrollDeductionRepayment>('payroll_deduction_repayments');
  for (const row of repaymentRows || []) {
    const local = await db.payroll_deduction_repayments.get(row.id);
    if (!local) {
      await db.payroll_deduction_repayments.put({ ...row, synced: 1 });
      pulled += 1;
    }
  }

  const attendanceRows = await pullTable<LocalPayrollAttendance>('payroll_attendance');
  for (const row of attendanceRows || []) {
    if (await mergeMutableRow(db.payroll_attendance, { ...row, synced: 1 }, 'attendance', row.work_date || 'attendance')) {
      pulled += 1;
    }
  }

  const taxRows = await pullTable<LocalPayrollTaxConfig>('payroll_tax_configs');
  for (const row of taxRows || []) {
    if (await mergeMutableRow(db.payroll_tax_configs, { ...row, synced: 1 }, 'tax_config', row.name || 'tax config')) {
      pulled += 1;
    }
  }

  const ruleRows = await pullTable<LocalPayrollRules>('payroll_rules');
  for (const row of ruleRows || []) {
    if (await mergeMutableRow(db.payroll_rules, { ...row, synced: 1 }, 'rules', 'payroll rules')) {
      pulled += 1;
    }
  }

  // Pay runs: locked status ALWAYS takes precedence over draft/reviewed/approved.
  const runRows = await pullTable<LocalPayrollRun>('payroll_runs');
  for (const remote of runRows || []) {
    const local = await db.payroll_runs.get(remote.id);
    if (!local) {
      await db.payroll_runs.put({ ...remote, synced: 1 });
      pulled += 1;
      continue;
    }
    const localRank = RUN_STATUS_RANK[local.status] ?? 0;
    const remoteRank = RUN_STATUS_RANK[remote.status] ?? 0;
    if (local.status === 'locked' && remote.status !== 'locked') {
      continue; // Never let a stale draft overwrite a locked month
    }
    if (remoteRank > localRank || (remoteRank === localRank && (remote.updated_at || '') > (local.updated_at || ''))) {
      await db.payroll_runs.put({ ...remote, synced: 1 });
      pulled += 1;
    }
  }

  const itemRows = await pullTable<LocalPayrollRunItem>('payroll_run_items');
  for (const remote of itemRows || []) {
    const local = await db.payroll_run_items.get(remote.id);
    if (!local) {
      await db.payroll_run_items.put({ ...remote, synced: 1 });
      pulled += 1;
      continue;
    }
    const parentRun = await db.payroll_runs.get(remote.pay_run_id);
    // Preserve 'paid' payment status if either side has already paid this staff member.
    const mergedPaymentStatus =
      local.payment_status === 'paid' || remote.payment_status === 'paid' ? 'paid' : 'unpaid';
    const paidAt = local.paid_at || remote.paid_at || null;
    const paidBy = local.paid_by || remote.paid_by || null;
    const paymentRef = local.payment_reference || remote.payment_reference || '';

    if (parentRun?.status === 'locked' && local.synced === 0) {
      if (mergedPaymentStatus !== local.payment_status) {
        await db.payroll_run_items.update(local.id, {
          payment_status: mergedPaymentStatus,
          paid_at: paidAt,
          paid_by: paidBy,
          payment_reference: paymentRef,
        });
      }
      continue;
    }
    if (local.synced === 1 || (remote.updated_at || '') > (local.updated_at || '')) {
      await db.payroll_run_items.put({
        ...remote,
        payment_status: mergedPaymentStatus,
        paid_at: paidAt,
        paid_by: paidBy,
        payment_reference: paymentRef,
        synced: 1,
      });
    }
  }

  const adjustmentRows = await pullTable<LocalPayrollAdjustment>('payroll_adjustments');
  for (const row of adjustmentRows || []) {
    const local = await db.payroll_adjustments.get(row.id);
    if (!local) {
      await db.payroll_adjustments.put({ ...row, synced: 1 });
      pulled += 1;
    }
  }

  const auditRows = await pullTable<LocalPayrollAuditLog>('payroll_audit_logs');
  for (const row of auditRows || []) {
    const local = await db.payroll_audit_logs.get(row.id);
    if (!local) {
      await db.payroll_audit_logs.put({ ...row, synced: 1 });
      pulled += 1;
    }
  }

  return pulled;
}

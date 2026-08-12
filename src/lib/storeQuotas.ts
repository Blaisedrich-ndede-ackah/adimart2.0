/**
 * Canonical admin store/warehouse quotas.
 * Prefer `store_quotas` table so saves survive even when `stores.max_stores` is missing.
 */

import { isSupabaseConfigured, supabase } from './supabase';

export interface StoreQuotaLimits {
  warehouse_enabled: boolean;
  max_shops: number;
  max_warehouses: number;
  max_stores: number;
}

const DEFAULT_QUOTA: StoreQuotaLimits = {
  warehouse_enabled: false,
  max_shops: 1,
  max_warehouses: 0,
  max_stores: 1,
};

export function normalizeStoreQuota(raw: Partial<StoreQuotaLimits> | null | undefined): StoreQuotaLimits {
  return {
    warehouse_enabled: Boolean(raw?.warehouse_enabled),
    max_shops: Math.max(1, Math.floor(Number(raw?.max_shops) || 1)),
    max_warehouses: Math.max(0, Math.floor(Number(raw?.max_warehouses) || 0)),
    max_stores: Math.max(1, Math.floor(Number(raw?.max_stores) || 1)),
  };
}

function isMissingRelationError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('store_quotas') ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache')
  );
}

function isMissingColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('max_stores') || m.includes('column') || m.includes('schema cache');
}

/** Load one store's quota from the canonical table (if present). */
export async function loadStoreQuota(storeId: string): Promise<StoreQuotaLimits | null> {
  if (!isSupabaseConfigured() || !storeId) return null;
  try {
    const { data, error } = await supabase
      .from('store_quotas')
      .select('warehouse_enabled, max_shops, max_warehouses, max_stores')
      .eq('store_id', storeId)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error.message)) return null;
      return null;
    }
    if (!data) return null;
    return normalizeStoreQuota(data as Partial<StoreQuotaLimits>);
  } catch {
    return null;
  }
}

/** Load all quotas keyed by store_id. */
export async function loadAllStoreQuotas(): Promise<Record<string, StoreQuotaLimits>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const { data, error } = await supabase
      .from('store_quotas')
      .select('store_id, warehouse_enabled, max_shops, max_warehouses, max_stores');
    if (error || !data) return {};
    const out: Record<string, StoreQuotaLimits> = {};
    for (const row of data) {
      const id = String((row as { store_id?: string }).store_id || '');
      if (!id) continue;
      out[id] = normalizeStoreQuota(row as Partial<StoreQuotaLimits>);
    }
    return out;
  } catch {
    return {};
  }
}

async function upsertStoreQuotasTable(
  storeId: string,
  limits: StoreQuotaLimits
): Promise<{ success: boolean; error?: string; missingTable?: boolean }> {
  const payload = {
    store_id: storeId,
    warehouse_enabled: limits.warehouse_enabled,
    max_shops: limits.max_shops,
    max_warehouses: limits.max_warehouses,
    max_stores: limits.max_stores,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('store_quotas')
    .upsert(payload, { onConflict: 'store_id' })
    .select('store_id, max_stores, max_warehouses, max_shops, warehouse_enabled')
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error.message)) {
      return {
        success: false,
        missingTable: true,
        error:
          `${error.message} — run supabase-migrate-store-quotas.sql in Supabase SQL editor.`,
      };
    }
    return { success: false, error: error.message };
  }

  if (!data) {
    return {
      success: false,
      error: 'Quota save returned no row — check Supabase RLS policies on store_quotas.',
    };
  }

  const saved = normalizeStoreQuota(data as Partial<StoreQuotaLimits>);
  if (
    saved.max_stores !== limits.max_stores ||
    saved.max_warehouses !== limits.max_warehouses ||
    saved.max_shops !== limits.max_shops ||
    saved.warehouse_enabled !== limits.warehouse_enabled
  ) {
    return { success: false, error: 'Quota save did not stick — values mismatched after write.' };
  }

  return { success: true };
}

async function updateStoresColumnsBestEffort(
  storeId: string,
  limits: StoreQuotaLimits
): Promise<{ success: boolean; error?: string }> {
  const full = {
    warehouse_enabled: limits.warehouse_enabled,
    max_shops: limits.max_shops,
    max_warehouses: limits.max_warehouses,
    max_stores: limits.max_stores,
  };

  let { data, error } = await supabase
    .from('stores')
    .update(full)
    .eq('id', storeId)
    .select('id, warehouse_enabled, max_shops, max_warehouses, max_stores')
    .maybeSingle();

  if (error && isMissingColumnError(error.message)) {
    // Older DBs without max_stores — still persist warehouse fields on stores
    const withoutMaxStores = {
      warehouse_enabled: limits.warehouse_enabled,
      max_shops: limits.max_shops,
      max_warehouses: limits.max_warehouses,
    };
    const retry = await supabase
      .from('stores')
      .update(withoutMaxStores)
      .eq('id', storeId)
      .select('id, warehouse_enabled, max_shops, max_warehouses')
      .maybeSingle();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    return { success: false, error: error.message };
  }
  if (!data) {
    return {
      success: false,
      error: 'Store update returned no row — check store id / RLS on stores.',
    };
  }
  return { success: true };
}

/**
 * Save quotas: write canonical store_quotas (required), mirror onto stores when possible.
 */
export async function saveStoreQuotas(
  storeId: string,
  rawLimits: StoreQuotaLimits
): Promise<{ success: boolean; error?: string; limits?: StoreQuotaLimits }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  if (!storeId) {
    return { success: false, error: 'Missing store id' };
  }

  const limits = normalizeStoreQuota(rawLimits);
  const quotaWrite = await upsertStoreQuotasTable(storeId, limits);

  if (!quotaWrite.success) {
    // Fall back to stores-only if quotas table is missing
    if (quotaWrite.missingTable) {
      const storeWrite = await updateStoresColumnsBestEffort(storeId, limits);
      if (!storeWrite.success) {
        return {
          success: false,
          error:
            `${quotaWrite.error || 'store_quotas missing'} Also failed stores update: ${
              storeWrite.error || 'unknown'
            }`,
        };
      }
      // Verify stores read-back for fields that exist
      const { data } = await supabase
        .from('stores')
        .select('warehouse_enabled, max_shops, max_warehouses, max_stores')
        .eq('id', storeId)
        .maybeSingle();
      const verified = normalizeStoreQuota({
        warehouse_enabled: Boolean(data?.warehouse_enabled),
        max_shops: Number(data?.max_shops) || limits.max_shops,
        max_warehouses: Number(data?.max_warehouses) || limits.max_warehouses,
        // If column missing, keep requested max_stores in response but warn
        max_stores:
          data && 'max_stores' in (data as object) && data.max_stores != null
            ? Number(data.max_stores)
            : limits.max_stores,
      });
      return {
        success: true,
        limits: verified,
        error:
          'Saved on stores only. Run supabase-migrate-store-quotas.sql so max store quotas persist reliably.',
      };
    }
    return { success: false, error: quotaWrite.error };
  }

  // Best-effort mirror onto stores (ignore failures — quotas table is source of truth)
  await updateStoresColumnsBestEffort(storeId, limits);

  return { success: true, limits };
}

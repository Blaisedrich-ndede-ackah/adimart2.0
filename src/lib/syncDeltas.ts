import { isSupabaseConfigured, supabase } from './supabase';
import { db } from './dexie';
import { signedStockDelta } from './syncConflict';

/** Push stock as add/subtract deltas keyed by the movement id so retries cannot double-apply. */
export async function pushUnsyncedStockDeltas(storeId: string): Promise<Set<string>> {
  const appliedBatches = new Set<string>();
  if (!isSupabaseConfigured()) return appliedBatches;
  const movements = await db.stock_movements.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  const byBatch = new Map<string, typeof movements>();
  for (const movement of movements) {
    if (!movement.batch_id) continue;
    const list = byBatch.get(movement.batch_id) || [];
    list.push(movement);
    byBatch.set(movement.batch_id, list);
  }
  for (const [batchId, batchMovements] of byBatch) {
    const existing = await supabase.from('stock_batches').select('id').eq('id', batchId).maybeSingle();
    if (existing.error) {
      if (/does not exist|schema cache|PGRST/i.test(existing.error.message)) return appliedBatches;
      continue;
    }
    if (!existing.data) continue;
    let latestQty: number | null = null;
    let rpcMissing = false;
    for (const movement of batchMovements) {
      const delta = signedStockDelta(movement);
      if (!delta) continue;
      const { data, error } = await supabase.rpc('apply_stock_delta', {
        p_batch_id: batchId,
        p_delta: delta,
        p_idempotency_key: movement.id,
        p_updated_at: new Date().toISOString(),
      });
      if (error) {
        if (/apply_stock_delta|PGRST202|does not exist|schema cache/i.test(error.message)) {
          rpcMissing = true;
          break;
        }
        continue;
      }
      latestQty = Number(data);
    }
    if (rpcMissing) return appliedBatches;
    if (latestQty !== null && Number.isFinite(latestQty)) {
      await db.stock_batches.update(batchId, {
        quantity: latestQty,
        synced: 1,
        updated_at: new Date().toISOString(),
      });
      appliedBatches.add(batchId);
    }
  }
  return appliedBatches;
}

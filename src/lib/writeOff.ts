import { db, generateId, type LocalStockWriteOff } from '@/lib/dexie';
import { allocateFefo, ensureStoreLocations, syncProductStockLevel } from '@/lib/warehouse';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { triggerPushSync } from '@/lib/sync';

export type StockWriteOff = LocalStockWriteOff;
export type WriteOffReason = StockWriteOff['reason'];

export async function recordWriteOff(
  storeId: string,
  productId: string,
  quantity: number,
  reason: WriteOffReason,
  photoDataUrl: string,
  note: string,
  userId: string,
  userName: string,
): Promise<void> {
  const qty = Math.floor(Number(quantity));
  if (!storeId || !productId || !userId || !Number.isFinite(qty) || qty < 1) throw new Error('Enter a valid product and quantity.');
  if (!['expired', 'damaged', 'other'].includes(reason)) throw new Error('Choose a write-off reason.');
  const product = await db.products.get(productId);
  if (!product || product.store_id !== storeId) throw new Error('Product not found in this store.');
  const locations = await ensureStoreLocations(storeId);
  const location = locations.find((entry) => entry.location_type === 'shop' && entry.is_default === 1)
    || locations.find((entry) => entry.location_type === 'shop') || locations[0];
  if (!location) throw new Error('Set up a shop location before recording write-offs.');
  const allocations = await allocateFefo(productId, location.id, qty);
  const createdAt = new Date().toISOString();
  const writeOff: StockWriteOff = {
    id: generateId(), store_id: storeId, product_id: productId, product_name: product.name,
    quantity: qty, base_quantity: qty, cost_price_at_writeoff: product.cost_price || 0, reason, photo_data_url: photoDataUrl,
    note: note.trim().slice(0, 500), created_by: userId,
    created_by_name: userName, created_at: createdAt, synced: 0,
  };
  await db.transaction('rw', [db.stock_batches, db.stock_movements, db.stock_write_offs], async () => {
    for (const allocation of allocations) {
      const batch = await db.stock_batches.get(allocation.batchId);
      if (!batch || batch.quantity < allocation.qty) throw new Error('Stock changed. Refresh and try again.');
      await db.stock_batches.update(batch.id, { quantity: batch.quantity - allocation.qty, updated_at: createdAt, synced: 0 });
      await db.stock_movements.add({
        id: generateId(), store_id: storeId, product_id: productId, batch_id: batch.id,
        from_location_id: location.id, to_location_id: null, movement_type: 'adjust',
        quantity: allocation.qty, note: `Write-off (${reason})${note.trim() ? `: ${note.trim()}` : ''}`,
        user_id: userId, created_at: createdAt, synced: 0,
      });
    }
    await db.stock_write_offs.add(writeOff);
  });
  await syncProductStockLevel(productId);
  void triggerPushSync('stock-write-off');
  void syncWriteOffs(storeId).catch(() => 0);
}

export async function listWriteOffs(storeId: string, from?: string, to?: string): Promise<StockWriteOff[]> {
  const rows = await db.stock_write_offs.where('store_id').equals(storeId).filter((row) =>
    (!from || row.created_at >= from) && (!to || row.created_at <= to)
  ).toArray();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getWriteOffSummary(storeId: string, from: string, to: string) {
  const rows = await listWriteOffs(storeId, from, to);
  const products = new Map((await db.products.where('store_id').equals(storeId).toArray()).map((row) => [row.id, row]));
  const byReason: Record<WriteOffReason, number> = { expired: 0, damaged: 0, other: 0 };
  let totalItems = 0;
  let totalValue = 0;
  for (const row of rows) {
    totalItems += row.quantity;
    byReason[row.reason] += row.quantity;
    totalValue += row.quantity * (row.cost_price_at_writeoff || products.get(row.product_id)?.cost_price || 0);
  }
  return { totalItems, totalValue, byReason };
}

export async function syncWriteOffs(storeId: string): Promise<number> {
  if (!storeId || !isSupabaseConfigured() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  const pending = await db.stock_write_offs.where('store_id').equals(storeId).filter((row) => row.synced === 0).toArray();
  let synced = 0;
  for (const row of pending) {
    const { synced: _localSynced, ...cloudRow } = row;
    const { error } = await supabase.from('stock_write_offs').upsert(cloudRow);
    if (!error) {
      await db.stock_write_offs.update(row.id, { synced: 1 });
      synced++;
    }
  }
  const { data } = await supabase.from('stock_write_offs').select('*').eq('store_id', storeId);
  if (data) for (const row of data) {
    const local = await db.stock_write_offs.get(row.id);
    if (!local || local.synced !== 0) await db.stock_write_offs.put({ ...row, synced: 1 });
  }
  return synced;
}

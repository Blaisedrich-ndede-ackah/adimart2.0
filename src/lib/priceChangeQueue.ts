import { db, generateId, type PriceChange } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const activeFlushes = new Map<string, Promise<number>>();

export async function queuePriceChange(
  storeId: string,
  productId: string,
  previousPrice: number,
  newPrice: number
): Promise<void> {
  if (!Number.isFinite(newPrice) || newPrice < 0) throw new Error('Enter a valid selling price.');
  const product = await db.products.get(productId);
  if (!product || product.store_id !== storeId) throw new Error('Product not found in this store.');
  const previous = Number.isFinite(previousPrice) ? previousPrice : product.selling_price;
  if (Math.abs(previous - newPrice) < 0.005) return;

  const changedAt = new Date().toISOString();
  const change: PriceChange = {
    id: generateId(),
    store_id: storeId,
    product_id: productId,
    previous_price: previous,
    new_price: newPrice,
    changed_at: changedAt,
    synced: 0,
    applied: 1,
  };

  await db.transaction('rw', [db.products, db.price_changes], async () => {
    await db.products.update(productId, {
      selling_price: newPrice,
      updated_at: changedAt,
      synced: 0,
    });
    await db.price_changes.add(change);
  });

  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    void flushPriceChanges(storeId).catch(() => undefined);
  }
}

export async function getPendingPriceChanges(storeId: string): Promise<PriceChange[]> {
  if (!storeId) return [];
  const changes = await db.price_changes.where('store_id').equals(storeId).toArray();
  return changes.filter((change) => change.synced === 0).sort((a, b) => a.changed_at.localeCompare(b.changed_at));
}

export async function applyPriceChangeLocally(
  storeId: string,
  productId: string,
  newPrice: number
): Promise<void> {
  if (!Number.isFinite(newPrice) || newPrice < 0) throw new Error('Enter a valid selling price.');
  const product = await db.products.get(productId);
  if (!product || product.store_id !== storeId) throw new Error('Product not found in this store.');
  await db.products.update(productId, {
    selling_price: newPrice,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export function flushPriceChanges(storeId: string): Promise<number> {
  const running = activeFlushes.get(storeId);
  if (running) return running;
  const flush = flushPending(storeId).finally(() => activeFlushes.delete(storeId));
  activeFlushes.set(storeId, flush);
  return flush;
}

async function flushPending(storeId: string): Promise<number> {
  if (!storeId || !isSupabaseConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
  const changes = await getPendingPriceChanges(storeId);
  let count = 0;
  for (const change of changes) {
    try {
      const { data, error } = await supabase
        .from('products')
        .update({ selling_price: change.new_price, updated_at: change.changed_at })
        .eq('id', change.product_id)
        .eq('store_id', storeId)
        .select('id')
        .maybeSingle();
      if (error) break;
      if (!data) continue;
      await db.price_changes.update(change.id, { synced: 1, applied: 1 });
      count += 1;
    } catch {
      break;
    }
  }
  return count;
}

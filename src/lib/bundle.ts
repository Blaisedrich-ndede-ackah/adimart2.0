import { db, generateId, type LocalBundleComponent, type LocalProductBundle, type LocalProduct } from '@/lib/dexie';
import { allocateFefo, getLocationStockMap, ensureStoreLocations, syncProductStockLevel } from '@/lib/warehouse';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface ProductBundle extends LocalProductBundle {}
export interface BundleComponent extends LocalBundleComponent {}
export type BundleWithProducts = { bundle: ProductBundle; components: Array<BundleComponent & { product: LocalProduct }> };

export async function createBundle(
  storeId: string,
  name: string,
  comboPrice: number,
  components: Array<{ productId: string; quantity: number }>,
  bundleId = generateId(),
): Promise<void> {
  const cleanName = name.trim().slice(0, 100);
  const price = Math.max(0, Number(comboPrice) || 0);
  if (!storeId || !cleanName || price <= 0) throw new Error('Enter a bundle name and price greater than zero.');
  const normalized = new Map<string, number>();
  for (const row of components) {
    const quantity = Math.floor(Number(row.quantity));
    if (!row.productId || !Number.isFinite(quantity) || quantity < 1) throw new Error('Each bundle product needs a whole quantity of at least one.');
    normalized.set(row.productId, (normalized.get(row.productId) || 0) + quantity);
  }
  if (normalized.size < 2) throw new Error('Add at least two different products to a bundle.');
  const products = await Promise.all([...normalized.keys()].map((id) => db.products.get(id)));
  if (products.some((product) => !product || product.store_id !== storeId || product.is_active !== 1)) {
    throw new Error('Every bundle product must be active and belong to this store.');
  }
  const bundle: ProductBundle = { id: bundleId, store_id: storeId, name: cleanName, combo_price: price, is_active: 1, synced: 0 };
  const rows: BundleComponent[] = [...normalized].map(([productId, quantity]) => ({
    id: generateId(), store_id: storeId, bundle_id: bundleId, product_id: productId, quantity, synced: 0,
  }));
  await db.transaction('rw', [db.product_bundles, db.bundle_components], async () => {
    await db.product_bundles.put(bundle);
    await db.bundle_components.where('bundle_id').equals(bundleId).delete();
    await db.bundle_components.bulkPut(rows);
  });
  void syncBundles(storeId).catch(() => undefined);
}

export async function getBundleWithComponents(bundleId: string): Promise<BundleWithProducts | null> {
  const bundle = await db.product_bundles.get(bundleId);
  if (!bundle) return null;
  const components = await db.bundle_components.where('bundle_id').equals(bundleId).toArray();
  const rows: Array<BundleComponent & { product: LocalProduct }> = [];
  for (const component of components) {
    const product = await db.products.get(component.product_id);
    if (product && product.store_id === bundle.store_id) rows.push({ ...component, product });
  }
  return { bundle, components: rows };
}

export async function listBundles(storeId: string, activeOnly = true): Promise<ProductBundle[]> {
  return db.product_bundles.where('store_id').equals(storeId)
    .filter((bundle) => !activeOnly || bundle.is_active === 1).toArray();
}

export async function isBundleProduct(productId: string): Promise<boolean> {
  return Boolean(await db.product_bundles.get(productId));
}

export async function validateBundleStock(
  storeId: string,
  bundleId: string,
  quantity: number,
  locationId?: string | null,
): Promise<{ ok: boolean; missing?: string }> {
  const bundle = await getBundleWithComponents(bundleId);
  const qty = Math.floor(Number(quantity));
  if (!bundle || bundle.bundle.store_id !== storeId || !bundle.bundle.is_active || bundle.components.length < 2 || qty < 1) return { ok: false, missing: 'Bundle is unavailable.' };
  const locations = await ensureStoreLocations(storeId);
  const location = locationId || locations.find((row) => row.is_default === 1 && row.location_type === 'shop')?.id || locations[0]?.id;
  if (!location) return { ok: false, missing: 'No shop location is configured.' };
  const stock = await getLocationStockMap(storeId, location);
  for (const row of bundle.components) {
    const needed = row.quantity * qty;
    if ((stock[row.product_id] || 0) < needed) return { ok: false, missing: row.product.name };
  }
  return { ok: true };
}

export async function deductBundleStock(storeId: string, bundleId: string, quantity: number): Promise<void> {
  const bundle = await getBundleWithComponents(bundleId);
  const qty = Math.floor(Number(quantity));
  if (!bundle || bundle.bundle.store_id !== storeId || bundle.components.length < 2 || qty < 1) throw new Error('Bundle is unavailable.');
  const locations = await ensureStoreLocations(storeId);
  const location = locations.find((row) => row.is_default === 1 && row.location_type === 'shop') || locations[0];
  if (!location) throw new Error('No shop location is configured.');
  const planned = await Promise.all(bundle.components.map(async (row) => ({ row, allocations: await allocateFefo(row.product_id, location.id, row.quantity * qty) })));
  const now = new Date().toISOString();
  await db.transaction('rw', [db.stock_batches, db.stock_movements], async () => {
    for (const { row, allocations } of planned) for (const allocation of allocations) {
      const batch = await db.stock_batches.get(allocation.batchId);
      if (!batch || batch.quantity < allocation.qty) throw new Error(`Not enough stock for ${row.product.name}.`);
      await db.stock_batches.update(batch.id, { quantity: batch.quantity - allocation.qty, updated_at: now, synced: 0 });
      await db.stock_movements.add({
        id: generateId(), store_id: storeId, product_id: row.product_id, batch_id: batch.id,
        from_location_id: location.id, to_location_id: null, movement_type: 'sale',
        quantity: allocation.qty, note: `Bundle sale: ${bundle.bundle.name}`, user_id: null,
        created_at: now, synced: 0,
      });
    }
  });
  await Promise.all(bundle.components.map((row) => syncProductStockLevel(row.product_id)));
}

export async function syncBundles(storeId: string): Promise<number> {
  if (!storeId || !isSupabaseConfigured() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  let count = 0;
  const bundles = await db.product_bundles.where('store_id').equals(storeId).filter((row) => row.synced === 0).toArray();
  for (const bundle of bundles) {
    const { synced: _localSynced, ...localCloudRow } = bundle;
    const cloudRow = { ...localCloudRow, is_active: bundle.is_active === 1 };
    const { error } = await supabase.from('product_bundles').upsert(cloudRow);
    if (!error) { await db.product_bundles.update(bundle.id, { synced: 1 }); count++; }
  }
  const components = await db.bundle_components.where('store_id').equals(storeId).filter((row) => row.synced === 0).toArray();
  for (const component of components) {
    const { synced: _localSynced, ...cloudRow } = component;
    const { error } = await supabase.from('bundle_components').upsert(cloudRow);
    if (!error) { await db.bundle_components.update(component.id, { synced: 1 }); count++; }
  }
  const { data: remoteBundles } = await supabase.from('product_bundles').select('*').eq('store_id', storeId);
  if (remoteBundles) for (const row of remoteBundles) {
    const local = await db.product_bundles.get(row.id);
    if (!local || local.synced !== 0) await db.product_bundles.put({
      ...row, is_active: row.is_active === false ? 0 : 1, synced: 1,
    });
  }
  const { data: remoteComponents } = await supabase.from('bundle_components').select('*').eq('store_id', storeId);
  if (remoteComponents) for (const row of remoteComponents) {
    const local = await db.bundle_components.get(row.id);
    if (!local || local.synced !== 0) await db.bundle_components.put({ ...row, synced: 1 });
  }
  return count;
}

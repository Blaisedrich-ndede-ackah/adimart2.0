import {
  db,
  generateId,
  hashPin,
  type LocalLocation,
  type LocalProduct,
  type LocalStockBatch,
  type LocalStockMovement,
  type LocalStore,
  type LocalUser,
} from '@/lib/dexie';
import { emitStockChanged, type StockChange } from '@/lib/stockEvents';
import { isSupabaseConfigured } from '@/lib/supabase';
import { canonicalShopId, openingBatchId, legacyShopId, isUuid, stableUuid } from '@/lib/ids';

/** Beyond this, qty is treated as corrupt (e.g. string-concat / scientific junk). */
const MAX_REASONABLE_QTY = 50_000_000;
const MAX_REASONABLE_UNIT_PRICE = 100_000_000;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Coerce stock quantities from Dexie/cloud to a safe non-negative integer.
 * Critical: `0 + "5"` concatenates in JS — never add raw batch.quantity with `+`.
 * Also: `"0" || 0` is `"0"` (truthy), which spreads the string-concat bug.
 */
export function toQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const floored = Math.floor(n);
  if (floored > MAX_REASONABLE_QTY) return 0;
  return floored;
}

/** Coerce money fields; drop non-finite / absurd unit prices. */
export function toMoney(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > MAX_REASONABLE_UNIT_PRICE) return 0;
  return n;
}

/** True when value is a finite qty within the sane retail range (including 0). */
function isSaneQty(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_REASONABLE_QTY;
}

function isSaneMoney(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_REASONABLE_UNIT_PRICE;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function sortBatchesFefo(batches: LocalStockBatch[]): LocalStockBatch[] {
  return [...batches].sort((a, b) => {
    if (!a.expiry_date && !b.expiry_date) {
      return a.created_at.localeCompare(b.created_at);
    }
    if (!a.expiry_date) return 1;
    if (!b.expiry_date) return -1;
    const byExpiry = a.expiry_date.localeCompare(b.expiry_date);
    if (byExpiry !== 0) return byExpiry;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Avoid re-scanning every product on each POS/sale call */
const openingStockMigrated = new Set<string>();
const ensureInFlight = new Map<string, Promise<LocalLocation[]>>();

function isAutoDefaultShop(location: LocalLocation, storeId: string): boolean {
  if (location.location_type !== 'shop') return false;
  if (location.id === canonicalShopId(storeId) || location.id === legacyShopId(storeId)) {
    return true;
  }
  return location.name.trim().toLowerCase() === 'shop';
}

function isOpeningBatch(batch: LocalStockBatch): boolean {
  return (batch.batch_code || '').trim().toUpperCase() === 'OPENING';
}

function batchTime(batch: LocalStockBatch): number {
  return new Date(batch.updated_at || batch.created_at || 0).getTime();
}

/** Among duplicate OPENING rows, keep the live ledger (newest), not the inflated copy. */
function pickCanonicalOpening(a: LocalStockBatch, b: LocalStockBatch): LocalStockBatch {
  const aQty = toQty(a.quantity);
  const bQty = toQty(b.quantity);
  if ((aQty > 0) !== (bQty > 0)) return aQty > 0 ? a : b;
  const aTime = batchTime(a);
  const bTime = batchTime(b);
  if (aTime !== bTime) return aTime > bTime ? a : b;
  if (aQty !== bQty) return aQty < bQty ? a : b;
  if (a.id.startsWith('opening_') !== b.id.startsWith('opening_')) {
    // Prefer a real UUID (cloud / v5) over leftover `opening_*` strings.
    return a.id.startsWith('opening_') ? b : a;
  }
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

async function ensureDefaultLocation(storeId: string): Promise<LocalLocation[]> {
  const now = nowIso();
  const shopId = canonicalShopId(storeId);
  const existing = await db.locations.get(shopId);
  if (!existing) {
    const shop: LocalLocation = {
      id: shopId,
      store_id: storeId,
      name: 'Shop',
      location_type: 'shop',
      is_default: 1,
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 0,
    };
    try {
      await db.locations.add(shop);
    } catch {
      const raced = await db.locations.get(shopId);
      if (!raced) throw new Error('Could not create default shop location');
    }
  } else if (existing.is_active !== 1 || existing.is_default !== 1) {
    await db.locations.update(shopId, {
      is_active: 1,
      is_default: 1,
      updated_at: now,
      synced: 0,
    });
  }

  return db.locations.where('store_id').equals(storeId).toArray();
}

/**
 * Collapse phone/laptop duplicate default shops and duplicate OPENING batches
 * so every device sums the same on-hand quantities.
 */
export async function canonicalizeStoreStock(storeId: string): Promise<boolean> {
  const now = nowIso();
  await ensureDefaultLocation(storeId);

  const canonicalId = canonicalShopId(storeId);
  const [locations, batches] = await Promise.all([
    db.locations.where('store_id').equals(storeId).toArray(),
    db.stock_batches.where('store_id').equals(storeId).toArray(),
  ]);

  const qtyOnLocation = (locationId: string) =>
    batches.some((b) => b.location_id === locationId && toQty(b.quantity) > 0);

  const duplicateShops = locations.filter(
    (l) =>
      isAutoDefaultShop(l, storeId) &&
      l.id !== canonicalId &&
      (l.is_active === 1 || qtyOnLocation(l.id))
  );
  const dupeIds = new Set(duplicateShops.map((l) => l.id));
  const extraLocations = locations.filter((l) => l.id !== canonicalId);
  const extraIds = new Set(extraLocations.map((l) => l.id));

  const byId = new Map<string, LocalStockBatch>();
  const noteChange = (row: LocalStockBatch) => {
    byId.set(row.id, row);
  };
  const idsToDelete = new Set<string>();
  const openingIdMap = new Map<string, string>();

  let changed = false;

  const working: LocalStockBatch[] = batches.map((batch) => {
    const needsShop =
      extraIds.has(batch.location_id) || dupeIds.has(batch.location_id) || !isUuid(batch.location_id);
    if (!needsShop) return batch;
    changed = true;
    const next = {
      ...batch,
      location_id: canonicalId,
      updated_at: now,
      synced: 0,
    };
    noteChange(next);
    return next;
  });

  const openingsByProduct = new Map<string, LocalStockBatch[]>();
  for (const batch of working) {
    if (!isOpeningBatch(batch)) continue;
    const list = openingsByProduct.get(batch.product_id) || [];
    list.push(batch);
    openingsByProduct.set(batch.product_id, list);
  }

  for (const [productId, openings] of openingsByProduct) {
    const destId = openingBatchId(storeId, productId);
    const live = openings.filter((b) => toQty(b.quantity) > 0);
    if (live.length === 0) {
      for (const extra of openings) {
        if (extra.id !== destId && !isUuid(extra.id)) idsToDelete.add(extra.id);
      }
      continue;
    }

    const alreadyCanonical =
      live.length === 1 && live[0].id === destId && live[0].location_id === canonicalId;
    if (alreadyCanonical) {
      for (const extra of openings) {
        if (extra.id !== destId && !isUuid(extra.id)) idsToDelete.add(extra.id);
      }
      continue;
    }

    let winner = live[0];
    for (let i = 1; i < live.length; i++) {
      winner = pickCanonicalOpening(winner, live[i]);
    }

    changed = true;
    noteChange({
      ...winner,
      id: destId,
      location_id: canonicalId,
      batch_code: 'OPENING',
      quantity: toQty(winner.quantity),
      cost_price: toMoney(winner.cost_price),
      updated_at: winner.updated_at || now,
      synced: 0,
    });

    for (const extra of openings) {
      if (extra.id === destId) continue;
      openingIdMap.set(extra.id, destId);
      if (!isUuid(extra.id)) {
        idsToDelete.add(extra.id);
        continue;
      }
      noteChange({
        ...extra,
        quantity: 0,
        location_id: canonicalId,
        updated_at: now,
        synced: 0,
      });
    }
  }

  for (const batch of working) {
    const current = byId.get(batch.id) || batch;
    if (idsToDelete.has(current.id)) continue;
    if (!isUuid(current.id) || !isUuid(current.product_id)) {
      if (toQty(current.quantity) > 0 && isUuid(current.product_id)) {
        noteChange({
          ...current,
          id: stableUuid(`batch:${storeId}:${current.id}`),
          location_id: canonicalId,
          updated_at: now,
          synced: 0,
        });
      }
      idsToDelete.add(current.id);
      continue;
    }
    if (current.location_id === canonicalId && isUuid(current.location_id)) continue;
    changed = true;
    noteChange({
      ...current,
      location_id: canonicalId,
      updated_at: now,
      synced: 0,
    });
  }

  for (const id of idsToDelete) {
    byId.delete(id);
  }
  if (byId.size > 0) {
    await db.stock_batches.bulkPut([...byId.values()]);
  }
  for (const id of idsToDelete) {
    await db.stock_batches.delete(id);
    changed = true;
  }

  if (extraLocations.length > 0 || openingIdMap.size > 0) {
    changed = true;
    const movements = await db.stock_movements.where('store_id').equals(storeId).toArray();
    const movementWrites: LocalStockMovement[] = [];
    const movementDeletes: string[] = [];
    for (const movement of movements) {
      if (!isUuid(movement.id) || !isUuid(movement.product_id)) {
        movementDeletes.push(movement.id);
        continue;
      }
      const fromId =
        movement.from_location_id && extraIds.has(movement.from_location_id)
          ? canonicalId
          : movement.from_location_id;
      const toId =
        movement.to_location_id && extraIds.has(movement.to_location_id)
          ? canonicalId
          : movement.to_location_id;
      const mappedBatch = movement.batch_id ? openingIdMap.get(movement.batch_id) : undefined;
      const batchId = mappedBatch || movement.batch_id;
      if (
        fromId !== movement.from_location_id ||
        toId !== movement.to_location_id ||
        batchId !== movement.batch_id
      ) {
        movementWrites.push({
          ...movement,
          batch_id: batchId,
          from_location_id: fromId,
          to_location_id: toId,
          synced: 0,
        });
      }
    }
    if (movementWrites.length > 0) {
      await db.stock_movements.bulkPut(movementWrites);
    }
    for (const id of movementDeletes) {
      await db.stock_movements.delete(id);
    }

    const users = await db.users.where('store_id').equals(storeId).toArray();
    for (const user of users) {
      if (user.assigned_location_id && extraIds.has(user.assigned_location_id)) {
        await db.users.update(user.id, {
          assigned_location_id: canonicalId,
          synced: 0,
        });
      }
    }

    const txns = await db.transactions.where('store_id').equals(storeId).toArray();
    for (const txn of txns) {
      if (txn.location_id && extraIds.has(txn.location_id)) {
        await db.transactions.update(txn.id, {
          location_id: canonicalId,
          synced: 0,
        });
      }
    }

    const items = await db.transaction_items.where('store_id').equals(storeId).toArray();
    for (const item of items) {
      if (item.batch_id && openingIdMap.has(item.batch_id)) {
        await db.transaction_items.update(item.id, {
          batch_id: openingIdMap.get(item.batch_id),
          synced: 0,
        });
      }
    }

    for (const extra of extraLocations) {
      if (!isUuid(extra.id)) {
        await db.locations.delete(extra.id);
        continue;
      }
      if (extra.is_active === 0 && extra.is_default === 0) continue;
      await db.locations.update(extra.id, {
        is_active: 0,
        is_default: 0,
        updated_at: now,
        synced: 0,
      });
    }
  }

  const canonical = await db.locations.get(canonicalId);
  if (canonical && (canonical.is_active !== 1 || canonical.is_default !== 1)) {
    await db.locations.update(canonicalId, {
      is_active: 1,
      is_default: 1,
      updated_at: now,
      synced: 0,
    });
    changed = true;
  }

  if (changed) {
    const products = await db.products.where('store_id').equals(storeId).toArray();
    await alignProductsWithBatchStock(products);
  }

  return changed;
}

export async function ensureStoreLocations(storeId: string): Promise<LocalLocation[]> {
  const existing = ensureInFlight.get(storeId);
  if (existing) return existing;

  const run = (async () => {
    // One-time (per session) cloud heal + opening-stock migration
    if (openingStockMigrated.has(storeId)) {
      await ensureDefaultLocation(storeId);
      return db.locations.where('store_id').equals(storeId).toArray();
    }

    // Pull cloud BEFORE creating a local shop UUID. Chrome and Opera each have
    // their own IndexedDB; the cloud ledger is what they must share.
    let pulledCloudStock = false;
    if (isSupabaseConfigured()) {
      try {
        const { pullStockLedgerFromCloud } = await import('@/lib/dexie');
        pulledCloudStock = await pullStockLedgerFromCloud(storeId);
      } catch {
        pulledCloudStock = false;
      }
    }

    await ensureDefaultLocation(storeId);

    try {
      await canonicalizeStoreStock(storeId);
    } catch {
      // Local duplicate collapse is best-effort
    }

    // Never mint OPENING from this browser's catalog while cloud is configured
    // but unreachable — that is what made Opera and Chrome show different stock.
    const allowOpeningMigration = pulledCloudStock || !isSupabaseConfigured();

    if (allowOpeningMigration) {
      const locations = await db.locations.where('store_id').equals(storeId).toArray();
      const defaultShop =
        locations.find((l) => l.id === canonicalShopId(storeId)) ||
        locations.find((l) => l.is_default === 1 && l.location_type === 'shop' && l.is_active === 1) ||
        locations.find((l) => l.location_type === 'shop' && l.is_active === 1) ||
        locations[0];

      if (defaultShop) {
        const now = nowIso();
        const products = await db.products.where('store_id').equals(storeId).toArray();
        const allBatches = await db.stock_batches.where('store_id').equals(storeId).toArray();
        // Any batch row (even qty 0) means the product was already migrated
        const productsWithBatchRows = new Set(allBatches.map((b) => b.product_id));

        const newBatches: LocalStockBatch[] = [];
        const newMovements: LocalStockMovement[] = [];

        for (const product of products) {
          if (productsWithBatchRows.has(product.id)) continue;
          const openingQty = toQty(product.stock_level);
          if (openingQty <= 0) continue;

          const batchId = openingBatchId(storeId, product.id);
          newBatches.push({
            id: batchId,
            store_id: storeId,
            product_id: product.id,
            location_id: defaultShop.id,
            batch_code: 'OPENING',
            expiry_date: null,
            quantity: openingQty,
            cost_price: toMoney(product.cost_price),
            created_at: now,
            updated_at: now,
            synced: 0,
          });
          newMovements.push({
            id: generateId(),
            store_id: storeId,
            product_id: product.id,
            batch_id: batchId,
            from_location_id: null,
            to_location_id: defaultShop.id,
            movement_type: 'receive',
            quantity: openingQty,
            note: 'Migrated opening stock',
            user_id: null,
            created_at: now,
            synced: 0,
          });
        }

        if (newBatches.length > 0) {
          await db.stock_batches.bulkPut(newBatches);
          await db.stock_movements.bulkAdd(newMovements);
        }
      }
    }

    openingStockMigrated.add(storeId);
    return db.locations.where('store_id').equals(storeId).toArray();
  })();

  ensureInFlight.set(storeId, run);
  try {
    return await run;
  } finally {
    ensureInFlight.delete(storeId);
  }
}

export async function listLocations(storeId: string): Promise<LocalLocation[]> {
  await ensureStoreLocations(storeId);
  return db.locations
    .where('store_id')
    .equals(storeId)
    .and((l) => l.is_active === 1)
    .toArray();
}

export async function createLocation(params: {
  storeId: string;
  name: string;
  locationType: 'shop' | 'warehouse';
  accessPin?: string;
}): Promise<LocalLocation> {
  const store = await db.stores.get(params.storeId);
  if (!store) throw new Error('Store not found');

  await ensureStoreLocations(params.storeId);
  const existing = await db.locations.where('store_id').equals(params.storeId).toArray();
  const activeOfType = existing.filter(
    (l) => l.location_type === params.locationType && l.is_active === 1
  );

  const maxShops = store.max_shops ?? 1;
  const maxWarehouses = store.max_warehouses ?? 0;

  if (params.locationType === 'warehouse') {
    if ((store.warehouse_enabled ?? 0) !== 1) {
      throw new Error('Warehouse not enabled — contact administrator');
    }
    if (activeOfType.length >= maxWarehouses) {
      throw new Error(`Maximum warehouses reached (${maxWarehouses}). Ask admin to raise your limit.`);
    }
    if (!params.accessPin || params.accessPin.length !== 4) {
      throw new Error('Create a 4-digit PIN to open and manage this warehouse');
    }
  } else if (activeOfType.length >= maxShops) {
    throw new Error(`Maximum shops reached (${maxShops})`);
  }

  const now = nowIso();
  const location: LocalLocation = {
    id: generateId(),
    store_id: params.storeId,
    name: params.name.trim() || (params.locationType === 'warehouse' ? 'Warehouse' : 'Shop'),
    location_type: params.locationType,
    is_default: 0,
    is_active: 1,
    access_pin_hash:
      params.locationType === 'warehouse' && params.accessPin
        ? hashPin(params.accessPin)
        : null,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.locations.add(location);
  return location;
}

export async function setLocationAccessPin(
  locationId: string,
  pin: string
): Promise<void> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be 4 digits');
  }
  const location = await db.locations.get(locationId);
  if (!location) throw new Error('Location not found');
  if (location.location_type !== 'warehouse') {
    throw new Error('Only warehouses use an access PIN');
  }
  const now = nowIso();
  await db.locations.update(locationId, {
    access_pin_hash: hashPin(pin),
    updated_at: now,
    synced: 0,
  });
}

export async function verifyLocationAccessPin(
  locationId: string,
  pin: string
): Promise<boolean> {
  const location = await db.locations.get(locationId);
  if (!location?.access_pin_hash) return false;
  return location.access_pin_hash === hashPin(pin);
}

export async function locationHasAccessPin(locationId: string): Promise<boolean> {
  const location = await db.locations.get(locationId);
  return Boolean(location?.access_pin_hash);
}

export async function getPrimaryShopLocationId(storeId: string): Promise<string> {
  const shopId = canonicalShopId(storeId);
  const locations = await db.locations.where('store_id').equals(storeId).toArray();
  const shops = locations.filter((l) => l.location_type === 'shop');
  const batches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const qtyByLocation = new Map<string, number>();
  for (const batch of batches) {
    qtyByLocation.set(batch.location_id, (qtyByLocation.get(batch.location_id) || 0) + toQty(batch.quantity));
  }

  // Prefer the shop that actually holds stock so an empty local UUID does not hide cloud qty.
  let bestShop: LocalLocation | undefined;
  let bestQty = -1;
  for (const shop of shops) {
    const qty = qtyByLocation.get(shop.id) || 0;
    if (qty > bestQty) {
      bestQty = qty;
      bestShop = shop;
    }
  }
  if (bestShop && bestQty > 0) return bestShop.id;

  const canonical = shops.find((l) => l.id === shopId) || (await db.locations.get(shopId));
  if (canonical && canonical.store_id === storeId) return shopId;

  const shop =
    shops.find((l) => l.is_default === 1 && l.is_active === 1) ||
    shops.find((l) => l.is_active === 1) ||
    shops[0] ||
    locations.find((l) => l.is_active === 1) ||
    locations[0];
  if (shop) return shop.id;

  await ensureDefaultLocation(storeId);
  return shopId;
}

export async function getLocationStock(productId: string, locationId: string): Promise<number> {
  const batches = await db.stock_batches
    .where('product_id')
    .equals(productId)
    .and((b) => b.location_id === locationId)
    .toArray();
  return batches.reduce((sum, b) => sum + toQty(b.quantity), 0);
}

/** One query for POS product grid instead of N getLocationStock calls */
export async function getLocationStockMap(
  storeId: string,
  locationId: string
): Promise<Record<string, number>> {
  const batches = await db.stock_batches
    .where('store_id')
    .equals(storeId)
    .and((b) => b.location_id === locationId)
    .toArray();
  const map: Record<string, number> = {};
  for (const batch of batches) {
    map[batch.product_id] = (map[batch.product_id] || 0) + toQty(batch.quantity);
  }
  return map;
}

/** On-hand qty per product for this store's single shop (not other stores or leftover locations). */
export async function getStoreBatchStockMap(storeId: string): Promise<Record<string, number>> {
  const locationId = await getPrimaryShopLocationId(storeId);
  const batches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const map: Record<string, number> = {};
  for (const batch of batches) {
    if (batch.location_id !== locationId) continue;
    map[batch.product_id] = (map[batch.product_id] || 0) + toQty(batch.quantity);
  }
  // Products that only have leftover rows at inactive extra locations still count as 0 here
  for (const batch of batches) {
    if (Object.prototype.hasOwnProperty.call(map, batch.product_id)) continue;
    map[batch.product_id] = 0;
  }
  return map;
}

/**
 * Persist numeric batch/product quantities when IndexedDB has strings or absurd values.
 * Batches are the quantity authority whenever any batch row exists for a product
 * (including a total of 0 after a complete sell-out).
 */
export async function repairCorruptStockQuantities(storeId: string): Promise<number> {
  const now = nowIso();
  let fixed = 0;

  const batches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const batchFixes: LocalStockBatch[] = [];
  for (const batch of batches) {
    const qtyNeedsFix = !isSaneQty(batch.quantity) || typeof batch.quantity === 'string';
    const costNeedsFix = !isSaneMoney(batch.cost_price) || typeof batch.cost_price === 'string';
    if (!qtyNeedsFix && !costNeedsFix) continue;

    const safe = isSaneQty(batch.quantity) ? Math.floor(Number(batch.quantity)) : toQty(batch.quantity);
    const cost = isSaneMoney(batch.cost_price) ? Number(batch.cost_price) : toMoney(batch.cost_price);
    if (batch.quantity === safe && batch.cost_price === cost) continue;

    batchFixes.push({
      ...batch,
      quantity: safe,
      cost_price: cost,
      updated_at: now,
      synced: 0,
    });
  }
  if (batchFixes.length > 0) {
    await db.stock_batches.bulkPut(batchFixes);
    fixed += batchFixes.length;
  }

  const products = await db.products.where('store_id').equals(storeId).toArray();
  const batchMap = await getStoreBatchStockMap(storeId);
  const productFixes: LocalProduct[] = [];
  for (const product of products) {
    const hasBatches = Object.prototype.hasOwnProperty.call(batchMap, product.id);
    const catalogStock = isSaneQty(product.stock_level)
      ? Math.floor(Number(product.stock_level))
      : toQty(product.stock_level);

    // If batch rows exist, catalog must equal batch sum (including 0)
    const safeStock = hasBatches ? batchMap[product.id] || 0 : catalogStock;

    const cost = isSaneMoney(product.cost_price)
      ? Number(product.cost_price)
      : toMoney(product.cost_price);
    const sell = isSaneMoney(product.selling_price)
      ? Number(product.selling_price)
      : toMoney(product.selling_price);

    if (
      product.stock_level !== safeStock ||
      product.cost_price !== cost ||
      product.selling_price !== sell
    ) {
      productFixes.push({
        ...product,
        stock_level: safeStock,
        cost_price: cost,
        selling_price: sell,
        updated_at: now,
        // Pure stock heal from batches should not block cloud pull of other fields
        synced: hasBatches ? product.synced : 0,
      });
    }
  }
  if (productFixes.length > 0) {
    await db.products.bulkPut(productFixes);
    fixed += productFixes.length;
  }

  return fixed;
}

/**
 * Align product.stock_level with batch totals so Inventory / POS / devices match.
 * Batches are the sole quantity authority once a product has any batch rows.
 */
export async function alignProductsWithBatchStock(
  products: LocalProduct[]
): Promise<LocalProduct[]> {
  if (products.length === 0) return products;
  const storeId = products[0]?.store_id;
  if (!storeId) return products;

  try {
    await repairCorruptStockQuantities(storeId);
  } catch {
    // Never block inventory UI if repair fails
  }

  // Re-read after repair so we align the healed rows
  const fresh = await db.products.where('store_id').equals(storeId).toArray();
  const byId = new Map(fresh.map((p) => [p.id, p]));
  const source = products.map((p) => byId.get(p.id) || p);

  const batchMap = await getStoreBatchStockMap(storeId);
  const storeHasLedger = (await db.stock_batches.where('store_id').equals(storeId).count()) > 0;
  const aligned: LocalProduct[] = [];
  const writes: Promise<unknown>[] = [];

  for (const product of source) {
    const displayCost = isSaneMoney(product.cost_price)
      ? Number(product.cost_price)
      : toMoney(product.cost_price);
    const displaySell = isSaneMoney(product.selling_price)
      ? Number(product.selling_price)
      : toMoney(product.selling_price);
    const catalogStock = isSaneQty(product.stock_level)
      ? Math.floor(Number(product.stock_level))
      : toQty(product.stock_level);

    const hasBatches = Object.prototype.hasOwnProperty.call(batchMap, product.id);
    // Once this store has a batch ledger, catalog stock_level is not truth.
    // That stopped Opera (catalog copy) and Chrome (live batches) from disagreeing.
    const nextStock =
      storeHasLedger || hasBatches ? batchMap[product.id] || 0 : catalogStock;

    if (
      nextStock === product.stock_level &&
      displayCost === product.cost_price &&
      displaySell === product.selling_price
    ) {
      aligned.push(product);
      continue;
    }

    aligned.push({
      ...product,
      stock_level: nextStock,
      cost_price: displayCost,
      selling_price: displaySell,
    });

    const patch: Partial<LocalProduct> = {
      stock_level: nextStock,
      cost_price: displayCost,
      selling_price: displaySell,
    };
    // Only dirty sync when prices change; stock heal from batches must not block pulls
    if (displayCost !== product.cost_price || displaySell !== product.selling_price) {
      patch.updated_at = nowIso();
      patch.synced = 0;
    }
    writes.push(db.products.update(product.id, patch));
  }

  if (writes.length > 0) {
    try {
      await Promise.all(writes);
    } catch {
      // Still return aligned in-memory view
    }
  }
  return aligned;
}

/** Recompute every product.stock_level from batches and notify UI (after cloud pull). */
export async function syncStoreCatalogStockFromBatches(storeId: string): Promise<void> {
  const products = await db.products.where('store_id').equals(storeId).toArray();
  if (products.length === 0) return;
  const aligned = await alignProductsWithBatchStock(products);
  const changes = aligned.map((p) => ({
    productId: p.id,
    totalQty: toQty(p.stock_level),
  }));
  if (changes.length > 0) {
    emitStockChanged({
      storeId,
      reason: 'sync',
      changes,
    });
  }
}

export async function getProductTotalStock(productId: string): Promise<number> {
  const product = await db.products.get(productId);
  const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
  if (!product?.store_id) {
    return batches.reduce((sum, b) => sum + toQty(b.quantity), 0);
  }
  const locationId = await getPrimaryShopLocationId(product.store_id);
  return batches
    .filter((b) => b.location_id === locationId)
    .reduce((sum, b) => sum + toQty(b.quantity), 0);
}

export async function listBatches(
  productId: string,
  locationId?: string
): Promise<LocalStockBatch[]> {
  const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
  const filtered = locationId
    ? batches.filter((b) => b.location_id === locationId)
    : batches;
  return sortBatchesFefo(filtered.filter((b) => toQty(b.quantity) > 0));
}

export async function syncProductStockLevel(productId: string): Promise<number> {
  const total = await getProductTotalStock(productId);
  const product = await db.products.get(productId);
  await db.products.update(productId, {
    stock_level: total,
    updated_at: nowIso(),
    synced: 0,
  });
  if (product?.store_id) {
    emitStockChanged({
      storeId: product.store_id,
      reason: 'adjust',
      changes: [{ productId, totalQty: total }],
    });
  }
  return total;
}

/**
 * Align catalog stock with batches. Only creates an opening batch when the product
 * has ZERO batch rows (true first migration). Never invents stock when batches
 * already exist but catalog is stale-high — that caused sold-out items to reappear.
 */
export async function reconcileProductStockBatches(
  storeId: string,
  productId: string,
  preferredLocationId?: string | null
): Promise<number> {
  const product = await db.products.get(productId);
  if (!product || product.store_id !== storeId) {
    throw new Error('Product not found');
  }

  const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
  const batchTotal = batches.reduce((sum, b) => sum + toQty(b.quantity), 0);

  // Batches already exist: catalog must follow batches (never invent a RECONCILE gap)
  if (batches.length > 0) {
    if (toQty(product.stock_level) !== batchTotal) {
      await syncProductStockLevel(productId);
    }
    return batchTotal;
  }

  const target = isSaneQty(product.stock_level)
    ? Math.floor(Number(product.stock_level))
    : toQty(product.stock_level);
  if (target <= 0) return 0;

  let locations = await db.locations.where('store_id').equals(storeId).toArray();
  if (locations.length === 0) {
    locations = await ensureDefaultLocation(storeId);
  }

  const locationId =
    (preferredLocationId && locations.some((l) => l.id === preferredLocationId)
      ? preferredLocationId
      : null) ||
    locations.find((l) => l.is_default === 1 && l.is_active === 1)?.id ||
    locations.find((l) => l.location_type === 'shop' && l.is_active === 1)?.id ||
    locations[0]?.id;

  if (!locationId) {
    throw new Error('No location available to reconcile stock');
  }

  const now = nowIso();
  const batchId = openingBatchId(storeId, productId);
  await db.stock_batches.put({
    id: batchId,
    store_id: storeId,
    product_id: productId,
    location_id: locationId,
    batch_code: 'OPENING',
    expiry_date: null,
    quantity: target,
    cost_price: toMoney(product.cost_price),
    created_at: now,
    updated_at: now,
    synced: 0,
  });
  await db.stock_movements.add({
    id: generateId(),
    store_id: storeId,
    product_id: productId,
    batch_id: batchId,
    from_location_id: null,
    to_location_id: locationId,
    movement_type: 'adjust',
    quantity: target,
    note: 'Migrated opening stock into location batches',
    user_id: null,
    created_at: now,
    synced: 0,
  });
  return syncProductStockLevel(productId);
}

export async function setProductStockLevel(params: {
  storeId: string;
  productId: string;
  targetQty: number;
  locationId?: string | null;
  note?: string;
  userId?: string | null;
}): Promise<number> {
  await ensureStoreLocations(params.storeId);
  const target = Math.max(0, Math.floor(Number(params.targetQty) || 0));
  const current = await getProductTotalStock(params.productId);
  const delta = target - current;
  if (delta === 0) {
    return syncProductStockLevel(params.productId);
  }

  const locations = await db.locations.where('store_id').equals(params.storeId).toArray();
  const locationId =
    params.locationId ||
    locations.find((l) => l.is_default === 1 && l.is_active === 1)?.id ||
    locations.find((l) => l.location_type === 'shop' && l.is_active === 1)?.id ||
    locations[0]?.id;
  if (!locationId) throw new Error('No location available for stock update');

  await adjustLocationStock({
    storeId: params.storeId,
    productId: params.productId,
    locationId,
    delta,
    note: params.note || 'Inventory stock update',
    userId: params.userId || null,
  });
  // syncProductStockLevel (via adjust) already emits; return live totals
  const totalQty = await getProductTotalStock(params.productId);
  return totalQty;
}

export async function receiveStock(params: {
  storeId: string;
  productId: string;
  locationId: string;
  quantity: number;
  batchCode?: string;
  expiryDate?: string | null;
  costPrice?: number;
  userId?: string | null;
  note?: string;
}): Promise<LocalStockBatch> {
  const quantity = Math.floor(Number(params.quantity) || 0);
  if (quantity <= 0) throw new Error('Quantity must be greater than zero');

  await ensureStoreLocations(params.storeId);
  const location = await db.locations.get(params.locationId);
  if (!location || location.store_id !== params.storeId) {
    throw new Error('Location not found');
  }

  const product = await db.products.get(params.productId);
  if (!product || product.store_id !== params.storeId) {
    throw new Error('Product not found');
  }

  const now = nowIso();
  const batch: LocalStockBatch = {
    id: generateId(),
    store_id: params.storeId,
    product_id: params.productId,
    location_id: params.locationId,
    batch_code: (params.batchCode || '').trim(),
    expiry_date: dateOnly(params.expiryDate),
    quantity,
    cost_price: params.costPrice ?? product.cost_price ?? 0,
    created_at: now,
    updated_at: now,
    synced: 0,
  };

  await db.stock_batches.add(batch);
  await db.stock_movements.add({
    id: generateId(),
    store_id: params.storeId,
    product_id: params.productId,
    batch_id: batch.id,
    from_location_id: null,
    to_location_id: params.locationId,
    movement_type: 'receive',
    quantity,
    note: params.note || '',
    user_id: params.userId || null,
    created_at: now,
    synced: 0,
  });
  await syncProductStockLevel(params.productId);
  return batch;
}

export async function allocateFefo(
  productId: string,
  locationId: string,
  baseQty: number
): Promise<{ batchId: string; qty: number }[]> {
  const needed = Math.floor(Number(baseQty) || 0);
  if (needed <= 0) return [];

  const batches = sortBatchesFefo(
    (
      await db.stock_batches
        .where('product_id')
        .equals(productId)
        .and((b) => b.location_id === locationId && toQty(b.quantity) > 0)
        .toArray()
    )
  );

  const allocations: { batchId: string; qty: number }[] = [];
  let remaining = needed;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(toQty(batch.quantity), remaining);
    if (take <= 0) continue;
    allocations.push({ batchId: batch.id, qty: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error('Insufficient stock at location');
  }

  return allocations;
}

export async function transferStock(params: {
  storeId: string;
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  userId?: string | null;
  note?: string;
}): Promise<void> {
  const quantity = Math.floor(Number(params.quantity) || 0);
  if (quantity <= 0) throw new Error('Quantity must be greater than zero');
  if (params.fromLocationId === params.toLocationId) {
    throw new Error('Source and destination locations must differ');
  }

  await ensureStoreLocations(params.storeId);
  const [fromLoc, toLoc, product] = await Promise.all([
    db.locations.get(params.fromLocationId),
    db.locations.get(params.toLocationId),
    db.products.get(params.productId),
  ]);
  if (!fromLoc || fromLoc.store_id !== params.storeId) throw new Error('Source location not found');
  if (!toLoc || toLoc.store_id !== params.storeId) throw new Error('Destination location not found');
  if (!product || product.store_id !== params.storeId) throw new Error('Product not found');

  const allocations = await allocateFefo(params.productId, params.fromLocationId, quantity);
  const now = nowIso();

  for (const alloc of allocations) {
    const source = await db.stock_batches.get(alloc.batchId);
    if (!source || source.quantity < alloc.qty) {
      throw new Error('Insufficient stock at location');
    }

    await db.stock_batches.update(source.id, {
      quantity: source.quantity - alloc.qty,
      updated_at: now,
      synced: 0,
    });

    const destBatch: LocalStockBatch = {
      id: generateId(),
      store_id: params.storeId,
      product_id: params.productId,
      location_id: params.toLocationId,
      batch_code: source.batch_code,
      expiry_date: source.expiry_date,
      quantity: alloc.qty,
      cost_price: source.cost_price,
      created_at: now,
      updated_at: now,
      synced: 0,
    };
    await db.stock_batches.add(destBatch);

    await db.stock_movements.add({
      id: generateId(),
      store_id: params.storeId,
      product_id: params.productId,
      batch_id: source.id,
      from_location_id: params.fromLocationId,
      to_location_id: params.toLocationId,
      movement_type: 'transfer',
      quantity: alloc.qty,
      note: params.note || '',
      user_id: params.userId || null,
      created_at: now,
      synced: 0,
    });
  }

  await syncProductStockLevel(params.productId);
}

export async function deductSaleStock(params: {
  storeId: string;
  productId: string;
  locationId: string;
  baseQty: number;
  userId?: string | null;
  transactionId?: string | null;
}): Promise<{ batchId: string; qty: number }[]> {
  const quantity = Math.floor(Number(params.baseQty) || 0);
  if (quantity <= 0) return [];

  const liveBatches = sortBatchesFefo(
    (
      await db.stock_batches
        .where('product_id')
        .equals(params.productId)
        .and((b) => b.location_id === params.locationId && toQty(b.quantity) > 0)
        .toArray()
    )
  );

  const allocations: { batchId: string; qty: number }[] = [];
  let remaining = quantity;
  const updatedBatches: LocalStockBatch[] = [];
  const now = nowIso();

  for (const batch of liveBatches) {
    if (remaining <= 0) break;
    const onHand = toQty(batch.quantity);
    const take = Math.min(onHand, remaining);
    if (take <= 0) continue;
    allocations.push({ batchId: batch.id, qty: take });
    updatedBatches.push({
      ...batch,
      quantity: onHand - take,
      updated_at: now,
      synced: 0,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error('Insufficient stock at location');
  }

  const note = params.transactionId ? `Sale ${params.transactionId}` : 'Sale';
  const movements: LocalStockMovement[] = allocations.map((alloc) => ({
    id: generateId(),
    store_id: params.storeId,
    product_id: params.productId,
    batch_id: alloc.batchId,
    from_location_id: params.locationId,
    to_location_id: null,
    movement_type: 'sale' as const,
    quantity: alloc.qty,
    note,
    user_id: params.userId || null,
    created_at: now,
    synced: 0,
  }));

  await db.transaction('rw', db.stock_batches, db.stock_movements, db.products, async () => {
    if (updatedBatches.length > 0) {
      await db.stock_batches.bulkPut(updatedBatches);
    }
    if (movements.length > 0) {
      await db.stock_movements.bulkAdd(movements);
    }
    const total = await getProductTotalStock(params.productId);
    await db.products.update(params.productId, {
      stock_level: total,
      updated_at: now,
      synced: 0,
    });
  });

  return allocations;
}

/** Deduct stock for a whole cart in one IndexedDB transaction (faster checkout). */
export async function deductSaleStockForItems(params: {
  storeId: string;
  locationId: string;
  userId?: string | null;
  transactionId?: string | null;
  reason?: 'sale' | 'order';
  items: Array<{ productId: string; baseQty: number; name?: string }>;
}): Promise<StockChange[]> {
  if (params.items.length === 0) return [];

  const now = nowIso();
  const reason = params.reason || 'sale';
  const note = params.transactionId
    ? `${reason === 'order' ? 'Order' : 'Sale'} ${params.transactionId}`
    : reason === 'order'
      ? 'Online order'
      : 'Sale';

  const productIds = [...new Set(params.items.map((i) => i.productId))];
  if (productIds.length === 0) return [];

  // One query for all product batches (location allocation + store-wide totals)
  const allProductBatches = await db.stock_batches
    .where('product_id')
    .anyOf(productIds)
    .toArray();

  const batchesByProduct = new Map<string, LocalStockBatch[]>();
  for (const batch of allProductBatches) {
    if (batch.location_id !== params.locationId) continue;
    const list = batchesByProduct.get(batch.product_id) || [];
    list.push(batch);
    batchesByProduct.set(batch.product_id, list);
  }

  // Aggregate qty needed per product (multiple cart lines can share a SKU)
  const needByProduct = new Map<string, { qty: number; name?: string }>();
  for (const item of params.items) {
    const qty = Math.floor(Number(item.baseQty) || 0);
    if (qty <= 0) continue;
    const prev = needByProduct.get(item.productId);
    needByProduct.set(item.productId, {
      qty: (prev?.qty || 0) + qty,
      name: item.name || prev?.name,
    });
  }

  const updatedBatches: LocalStockBatch[] = [];
  const movements: LocalStockMovement[] = [];
  const touchedProducts = new Set<string>();
  const locationQtyAfter = new Map<string, number>();

  for (const [productId, need] of needByProduct) {
    const live = sortBatchesFefo(
      (batchesByProduct.get(productId) || []).filter((b) => toQty(b.quantity) > 0)
    );
    // Mutate working copies so multiple lines against same product allocate correctly
    const working = live.map((b) => ({ ...b, quantity: toQty(b.quantity) }));
    let remaining = need.qty;

    for (const batch of working) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      if (take <= 0) continue;
      batch.quantity -= take;
      batch.updated_at = now;
      batch.synced = 0;
      movements.push({
        id: generateId(),
        store_id: params.storeId,
        product_id: productId,
        batch_id: batch.id,
        from_location_id: params.locationId,
        to_location_id: null,
        movement_type: 'sale',
        quantity: take,
        note,
        user_id: params.userId || null,
        created_at: now,
        synced: 0,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new Error(
        `Insufficient stock for "${need.name || 'item'}". Not enough units at this location.`
      );
    }

    updatedBatches.push(...working);
    touchedProducts.add(productId);
    locationQtyAfter.set(
      productId,
      working.reduce((sum, b) => sum + (b.quantity || 0), 0)
    );
  }

  // In-memory store-wide totals (avoid N re-queries inside the transaction)
  const qtyByBatchId = new Map<string, number>();
  for (const batch of allProductBatches) {
    qtyByBatchId.set(batch.id, toQty(batch.quantity));
  }
  for (const batch of updatedBatches) {
    qtyByBatchId.set(batch.id, toQty(batch.quantity));
  }

  const totalQtyAfter = new Map<string, number>();
  for (const productId of touchedProducts) {
    let total = 0;
    for (const batch of allProductBatches) {
      if (batch.product_id !== productId) continue;
      total += qtyByBatchId.get(batch.id) ?? batch.quantity ?? 0;
    }
    totalQtyAfter.set(productId, total);
  }

  const changes: StockChange[] = [...touchedProducts].map((productId) => ({
    productId,
    deducted: needByProduct.get(productId)?.qty || 0,
    locationQty: locationQtyAfter.get(productId) ?? 0,
    totalQty: totalQtyAfter.get(productId) ?? 0,
  }));

  await db.transaction(
    'rw',
    db.stock_batches,
    db.stock_movements,
    db.products,
    async () => {
      if (updatedBatches.length > 0) {
        await db.stock_batches.bulkPut(updatedBatches);
      }
      if (movements.length > 0) {
        await db.stock_movements.bulkAdd(movements);
      }
      for (const change of changes) {
        await db.products.update(change.productId, {
          stock_level: change.totalQty ?? 0,
          updated_at: now,
          synced: 0,
        });
      }
    }
  );

  emitStockChanged({
    storeId: params.storeId,
    locationId: params.locationId,
    reason,
    changes,
  });

  return changes;
}

/** Default shop location used for online-order fulfillment stock. */
export async function getDefaultShopLocationId(storeId: string): Promise<string | null> {
  await ensureStoreLocations(storeId);
  const locations = await db.locations.where('store_id').equals(storeId).toArray();
  return (
    locations.find((l) => l.is_default === 1 && l.is_active === 1)?.id ||
    locations.find((l) => l.location_type === 'shop' && l.is_active === 1)?.id ||
    locations.find((l) => l.is_active === 1)?.id ||
    null
  );
}

export async function getExpiringBatches(
  storeId: string,
  withinDays: number,
  locationId?: string
): Promise<LocalStockBatch[]> {
  const days = Math.max(0, Math.floor(Number(withinDays) || 0));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const batches = await db.stock_batches
    .where('store_id')
    .equals(storeId)
    .and(
      (b) =>
        !!b.expiry_date &&
        b.quantity > 0 &&
        b.expiry_date <= cutoffStr &&
        (!locationId || b.location_id === locationId)
    )
    .toArray();

  return sortBatchesFefo(batches);
}

export interface LocationStockRow {
  product: LocalProduct;
  quantity: number;
  batchCount: number;
}

export interface LocationStats {
  skuCount: number;
  totalUnits: number;
  expiringSoon: number;
  batchCount: number;
}

export async function getLocationInventory(
  storeId: string,
  locationId: string
): Promise<LocationStockRow[]> {
  const [products, batches] = await Promise.all([
    db.products
      .where('store_id')
      .equals(storeId)
      .and((p) => p.is_active === 1)
      .toArray(),
    db.stock_batches
      .where('store_id')
      .equals(storeId)
      .and((b) => b.location_id === locationId && b.quantity > 0)
      .toArray(),
  ]);

  const byProduct = new Map<string, { quantity: number; batchCount: number }>();
  for (const batch of batches) {
    const prev = byProduct.get(batch.product_id) || { quantity: 0, batchCount: 0 };
    prev.quantity += toQty(batch.quantity);
    prev.batchCount += 1;
    byProduct.set(batch.product_id, prev);
  }

  const withStock = products
    .map((product) => {
      const stats = byProduct.get(product.id);
      if (!stats || stats.quantity <= 0) return null;
      return {
        product,
        quantity: stats.quantity,
        batchCount: stats.batchCount,
      };
    })
    .filter((row): row is LocationStockRow => row != null)
    .sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return a.product.name.localeCompare(b.product.name);
    });

  return withStock;
}

export async function getLocationStats(
  storeId: string,
  locationId: string
): Promise<LocationStats> {
  const batches = await db.stock_batches
    .where('store_id')
    .equals(storeId)
    .and((b) => b.location_id === locationId && b.quantity > 0)
    .toArray();

  const productIds = new Set(batches.map((b) => b.product_id));
  const expiring = await getExpiringBatches(storeId, 30, locationId);

  return {
    skuCount: productIds.size,
    totalUnits: batches.reduce((sum, b) => sum + toQty(b.quantity), 0),
    expiringSoon: expiring.length,
    batchCount: batches.length,
  };
}

export async function listLocationBatches(
  storeId: string,
  locationId: string,
  productId?: string
): Promise<LocalStockBatch[]> {
  const batches = await db.stock_batches
    .where('store_id')
    .equals(storeId)
    .and(
      (b) =>
        b.location_id === locationId &&
        b.quantity > 0 &&
        (!productId || b.product_id === productId)
    )
    .toArray();
  return sortBatchesFefo(batches);
}

export async function listLocationMovements(
  storeId: string,
  locationId: string,
  limit = 80
): Promise<LocalStockMovement[]> {
  const movements = await db.stock_movements
    .where('store_id')
    .equals(storeId)
    .and(
      (m) => m.from_location_id === locationId || m.to_location_id === locationId
    )
    .toArray();

  movements.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return movements.slice(0, Math.max(1, limit));
}

/**
 * Adjust stock at a specific location (warehouse-aware).
 * Positive delta creates an adjustment batch; negative uses FEFO deduction.
 */
export async function adjustLocationStock(params: {
  storeId: string;
  productId: string;
  locationId: string;
  delta: number;
  note?: string;
  userId?: string | null;
}): Promise<void> {
  const delta = Math.trunc(Number(params.delta) || 0);
  if (delta === 0) throw new Error('Adjustment quantity cannot be zero');

  await ensureStoreLocations(params.storeId);
  const [location, product] = await Promise.all([
    db.locations.get(params.locationId),
    db.products.get(params.productId),
  ]);
  if (!location || location.store_id !== params.storeId) {
    throw new Error('Location not found');
  }
  if (!product || product.store_id !== params.storeId) {
    throw new Error('Product not found');
  }

  const now = nowIso();
  const note = (params.note || '').trim() || 'Stock adjustment';

  if (delta > 0) {
    const batch: LocalStockBatch = {
      id: generateId(),
      store_id: params.storeId,
      product_id: params.productId,
      location_id: params.locationId,
      batch_code: 'ADJUST',
      expiry_date: null,
      quantity: delta,
      cost_price: product.cost_price || 0,
      created_at: now,
      updated_at: now,
      synced: 0,
    };
    await db.stock_batches.add(batch);
    await db.stock_movements.add({
      id: generateId(),
      store_id: params.storeId,
      product_id: params.productId,
      batch_id: batch.id,
      from_location_id: null,
      to_location_id: params.locationId,
      movement_type: 'adjust',
      quantity: delta,
      note,
      user_id: params.userId || null,
      created_at: now,
      synced: 0,
    });
  } else {
    const qty = Math.abs(delta);
    const allocations = await allocateFefo(params.productId, params.locationId, qty);
    for (const alloc of allocations) {
      const batch = await db.stock_batches.get(alloc.batchId);
      if (!batch || batch.quantity < alloc.qty) {
        throw new Error('Insufficient stock at location');
      }
      await db.stock_batches.update(batch.id, {
        quantity: batch.quantity - alloc.qty,
        updated_at: now,
        synced: 0,
      });
      await db.stock_movements.add({
        id: generateId(),
        store_id: params.storeId,
        product_id: params.productId,
        batch_id: batch.id,
        from_location_id: params.locationId,
        to_location_id: null,
        movement_type: 'adjust',
        quantity: alloc.qty,
        note,
        user_id: params.userId || null,
        created_at: now,
        synced: 0,
      });
    }
  }

  await syncProductStockLevel(params.productId);
}

export function canUserSellWholesale(user: LocalUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return (user.can_wholesale ?? 0) === 1;
}

export function canUserSellFromWarehouse(user: LocalUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return (user.can_sell_from_warehouse ?? 0) === 1;
}

export async function resolveSaleLocations(
  store: LocalStore,
  _user: LocalUser
): Promise<LocalLocation[]> {
  await ensureStoreLocations(store.id);
  const locationId = await getPrimaryShopLocationId(store.id);
  const shop = await db.locations.get(locationId);
  return shop && shop.store_id === store.id ? [shop] : [];
}

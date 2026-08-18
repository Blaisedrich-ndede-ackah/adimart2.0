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

function nowIso(): string {
  return new Date().toISOString();
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

async function ensureDefaultLocation(storeId: string): Promise<LocalLocation[]> {
  let locations = await db.locations.where('store_id').equals(storeId).toArray();
  if (locations.length > 0) return locations;

  const now = nowIso();
  const shop: LocalLocation = {
    id: generateId(),
    store_id: storeId,
    name: 'Shop',
    location_type: 'shop',
    is_default: 1,
    is_active: 1,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.locations.add(shop);
  return [shop];
}

export async function ensureStoreLocations(storeId: string): Promise<LocalLocation[]> {
  const existing = ensureInFlight.get(storeId);
  if (existing) return existing;

  const run = (async () => {
    const locations = await ensureDefaultLocation(storeId);

    // One-time (per session) opening-stock migration — do not re-scan catalog on every sale
    if (openingStockMigrated.has(storeId)) {
      return locations;
    }

    const defaultShop =
      locations.find((l) => l.is_default === 1 && l.location_type === 'shop' && l.is_active === 1) ||
      locations.find((l) => l.location_type === 'shop' && l.is_active === 1) ||
      locations[0];

    const now = nowIso();
    const products = await db.products.where('store_id').equals(storeId).toArray();
    const allBatches = await db.stock_batches.where('store_id').equals(storeId).toArray();
    const qtyByProduct = new Map<string, number>();
    for (const batch of allBatches) {
      qtyByProduct.set(
        batch.product_id,
        (qtyByProduct.get(batch.product_id) || 0) + (batch.quantity || 0)
      );
    }

    const newBatches: LocalStockBatch[] = [];
    const newMovements: LocalStockMovement[] = [];

    for (const product of products) {
      const batchTotal = qtyByProduct.get(product.id) || 0;
      if (batchTotal > 0) continue;
      if (!(product.stock_level > 0)) continue;

      const batchId = generateId();
      newBatches.push({
        id: batchId,
        store_id: storeId,
        product_id: product.id,
        location_id: defaultShop.id,
        batch_code: 'OPENING',
        expiry_date: null,
        quantity: product.stock_level,
        cost_price: product.cost_price || 0,
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
        quantity: product.stock_level,
        note: 'Migrated opening stock',
        user_id: null,
        created_at: now,
        synced: 0,
      });
    }

    if (newBatches.length > 0) {
      await db.stock_batches.bulkAdd(newBatches);
      await db.stock_movements.bulkAdd(newMovements);
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

export async function getLocationStock(productId: string, locationId: string): Promise<number> {
  const batches = await db.stock_batches
    .where('product_id')
    .equals(productId)
    .and((b) => b.location_id === locationId)
    .toArray();
  return batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
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
    map[batch.product_id] = (map[batch.product_id] || 0) + (batch.quantity || 0);
  }
  return map;
}

/** Total on-hand qty per product from batches (source of truth after sales). */
export async function getStoreBatchStockMap(storeId: string): Promise<Record<string, number>> {
  const batches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const map: Record<string, number> = {};
  for (const batch of batches) {
    map[batch.product_id] = (map[batch.product_id] || 0) + (batch.quantity || 0);
  }
  return map;
}

/**
 * Align product.stock_level with batch totals so Inventory / POS match across devices.
 * Returns products with corrected stock_level (and persists drift locally).
 */
export async function alignProductsWithBatchStock(
  products: LocalProduct[]
): Promise<LocalProduct[]> {
  if (products.length === 0) return products;
  const storeId = products[0]?.store_id;
  if (!storeId) return products;

  const batchMap = await getStoreBatchStockMap(storeId);
  const now = nowIso();
  const aligned: LocalProduct[] = [];
  const writes: Promise<unknown>[] = [];

  for (const product of products) {
    // Only trust batches when the product has been migrated into warehouse stock.
    // Products with no batch rows keep their catalog stock_level.
    if (!Object.prototype.hasOwnProperty.call(batchMap, product.id)) {
      aligned.push(product);
      continue;
    }
    const batchQty = batchMap[product.id] || 0;
    if (batchQty === product.stock_level) {
      aligned.push(product);
      continue;
    }
    aligned.push({ ...product, stock_level: batchQty });
    writes.push(
      db.products.update(product.id, {
        stock_level: batchQty,
        updated_at: now,
        synced: 0,
      })
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
  return aligned;
}

export async function getProductTotalStock(productId: string): Promise<number> {
  const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
  return batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
}

export async function listBatches(
  productId: string,
  locationId?: string
): Promise<LocalStockBatch[]> {
  const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
  const filtered = locationId
    ? batches.filter((b) => b.location_id === locationId)
    : batches;
  return sortBatchesFefo(filtered.filter((b) => b.quantity > 0));
}

export async function syncProductStockLevel(productId: string): Promise<number> {
  const total = await getProductTotalStock(productId);
  await db.products.update(productId, {
    stock_level: total,
    updated_at: nowIso(),
    synced: 0,
  });
  return total;
}

/**
 * Fast path: only touch the one product being sold/edited.
 * Does not re-scan the whole catalog (that is ensureStoreLocations' job, cached).
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
  const batchTotal = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
  const target = Math.max(0, Math.floor(Number(product.stock_level) || 0));
  const gap = target - batchTotal;

  if (gap < 0) {
    return syncProductStockLevel(productId);
  }
  if (gap === 0) {
    return batchTotal;
  }

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
  const batchId = generateId();
  await db.stock_batches.add({
    id: batchId,
    store_id: storeId,
    product_id: productId,
    location_id: locationId,
    batch_code: 'RECONCILE',
    expiry_date: null,
    quantity: gap,
    cost_price: product.cost_price || 0,
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
    quantity: gap,
    note: 'Reconciled inventory stock into location batches',
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
  return getProductTotalStock(params.productId);
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
        .and((b) => b.location_id === locationId && b.quantity > 0)
        .toArray()
    )
  );

  const allocations: { batchId: string; qty: number }[] = [];
  let remaining = needed;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
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
        .and((b) => b.location_id === params.locationId && b.quantity > 0)
        .toArray()
    )
  );

  const allocations: { batchId: string; qty: number }[] = [];
  let remaining = quantity;
  const updatedBatches: LocalStockBatch[] = [];
  const now = nowIso();

  for (const batch of liveBatches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take <= 0) continue;
    allocations.push({ batchId: batch.id, qty: take });
    updatedBatches.push({
      ...batch,
      quantity: batch.quantity - take,
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
  items: Array<{ productId: string; baseQty: number; name?: string }>;
}): Promise<void> {
  if (params.items.length === 0) return;

  const now = nowIso();
  const note = params.transactionId ? `Sale ${params.transactionId}` : 'Sale';

  const productIds = [...new Set(params.items.map((i) => i.productId))];
  if (productIds.length === 0) return;

  const allBatches = await db.stock_batches
    .where('product_id')
    .anyOf(productIds)
    .and((b) => b.location_id === params.locationId)
    .toArray();

  const batchesByProduct = new Map<string, LocalStockBatch[]>();
  for (const batch of allBatches) {
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

  for (const [productId, need] of needByProduct) {
    const live = sortBatchesFefo(
      (batchesByProduct.get(productId) || []).filter((b) => b.quantity > 0)
    );
    // Mutate working copies so multiple lines against same product allocate correctly
    const working = live.map((b) => ({ ...b }));
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
  }

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
      for (const productId of touchedProducts) {
        const total = (
          await db.stock_batches.where('product_id').equals(productId).toArray()
        ).reduce((sum, b) => sum + (b.quantity || 0), 0);
        await db.products.update(productId, {
          stock_level: total,
          updated_at: now,
          synced: 0,
        });
      }
    }
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
    prev.quantity += batch.quantity;
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
    totalUnits: batches.reduce((sum, b) => sum + b.quantity, 0),
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
  user: LocalUser
): Promise<LocalLocation[]> {
  const locations = await listLocations(store.id);
  const shops = locations.filter((l) => l.location_type === 'shop');
  const warehouses = locations.filter((l) => l.location_type === 'warehouse');

  if (user.assigned_location_id) {
    const assigned = locations.find((l) => l.id === user.assigned_location_id);
    if (assigned) {
      if (assigned.location_type === 'warehouse' && !canUserSellFromWarehouse(user)) {
        return shops;
      }
      return [assigned];
    }
  }

  if (canUserSellFromWarehouse(user) && (store.warehouse_enabled ?? 0) === 1) {
    return [...shops, ...warehouses];
  }
  return shops;
}

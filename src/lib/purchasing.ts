import {
  db,
  generateId,
  type LocalPurchaseOrder,
  type LocalSupplier,
  type PurchaseOrderLine,
} from '@/lib/dexie';
import { receiveStock } from '@/lib/warehouse';

export function parsePurchaseOrderLines(value: string): PurchaseOrderLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Purchase order items are invalid.');
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as PurchaseOrderLine).product_id === 'string' &&
      typeof (item as PurchaseOrderLine).product_name === 'string' &&
      Number.isSafeInteger((item as PurchaseOrderLine).quantity) &&
      (item as PurchaseOrderLine).quantity > 0 &&
      Number.isFinite((item as PurchaseOrderLine).unit_cost) &&
      (item as PurchaseOrderLine).unit_cost >= 0 &&
      Number.isSafeInteger((item as PurchaseOrderLine).received_quantity) &&
      (item as PurchaseOrderLine).received_quantity >= 0 &&
      (item as PurchaseOrderLine).received_quantity <= (item as PurchaseOrderLine).quantity
    )
  ) throw new Error('Purchase order items are invalid.');
  return parsed as PurchaseOrderLine[];
}

export async function addSupplier(params: Omit<LocalSupplier, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'>, storeId: string): Promise<void> {
  const name = params.name.trim();
  if (!name) throw new Error('Supplier name is required.');
  const now = new Date().toISOString();
  await db.suppliers.add({
    ...params,
    name,
    contact_name: params.contact_name.trim(),
    phone: params.phone.trim(),
    email: params.email.trim(),
    address: params.address.trim(),
    notes: params.notes.trim(),
    id: generateId(),
    store_id: storeId,
    created_at: now,
    updated_at: now,
    synced: 0,
  });
}

export async function createPurchaseOrder(params: {
  storeId: string;
  supplierId: string;
  items: PurchaseOrderLine[];
  notes: string;
}): Promise<void> {
  if (!params.supplierId) throw new Error('Choose a supplier.');
  if (params.items.length === 0) throw new Error('Add at least one product.');
  const lines = params.items.map((item) => {
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unit_cost);
    if (!item.product_id || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error('Each order line needs a product and positive whole quantity.');
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error('Each order line needs a valid unit cost.');
    }
    return { ...item, quantity, unit_cost: unitCost, received_quantity: 0 };
  });
  const supplier = await db.suppliers.get(params.supplierId);
  if (!supplier || supplier.store_id !== params.storeId || supplier.is_active !== 1) {
    throw new Error('The selected supplier is unavailable.');
  }
  const id = generateId();
  const now = new Date().toISOString();
  const order: LocalPurchaseOrder = {
    id,
    store_id: params.storeId,
    supplier_id: supplier.id,
    order_number: `PO-${now.slice(0, 10).replace(/-/g, '')}-${id.slice(0, 5).toUpperCase()}`,
    status: 'ordered',
    items_json: JSON.stringify(lines),
    total_amount: lines.reduce((total, line) => total + line.quantity * line.unit_cost, 0),
    notes: params.notes.trim(),
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.purchase_orders.add(order);
}

export async function receivePurchaseOrder(params: {
  orderId: string;
  storeId: string;
  locationId: string;
  userId: string;
  quantities: number[];
}): Promise<void> {
  await db.transaction(
    'rw',
    [db.purchase_orders, db.suppliers, db.products, db.locations, db.stock_batches, db.stock_movements],
    async () => {
      const order = await db.purchase_orders.get(params.orderId);
      if (!order || order.store_id !== params.storeId) throw new Error('Purchase order not found.');
      if (order.status !== 'ordered' && order.status !== 'partially_received') {
        throw new Error('Only open purchase orders can be received.');
      }
      const supplier = await db.suppliers.get(order.supplier_id);
      if (!supplier || supplier.store_id !== params.storeId) throw new Error('Supplier not found.');

      const items = parsePurchaseOrderLines(order.items_json);

      let hasReceipt = false;
      for (const [index, item] of items.entries()) {
        const remaining = Math.max(0, item.quantity - (Number(item.received_quantity) || 0));
        const quantity = params.quantities[index] ?? remaining;
        if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > remaining) {
          throw new Error(`Enter a whole received quantity from 0 to ${remaining} for "${item.product_name}".`);
        }
        if (quantity === 0) continue;
        const product = await db.products.get(item.product_id);
        if (!product || product.store_id !== params.storeId) {
          throw new Error(`Product "${item.product_name}" is no longer in this store.`);
        }
        await receiveStock({
          storeId: params.storeId,
          productId: item.product_id,
          locationId: params.locationId,
          quantity,
          costPrice: item.unit_cost,
          batchCode: order.order_number,
          userId: params.userId,
          note: `Purchase ${order.order_number} from ${supplier.name}`,
        });
        await db.products.update(product.id, {
          cost_price: item.unit_cost,
          updated_at: new Date().toISOString(),
          synced: 0,
        });
        item.received_quantity = (Number(item.received_quantity) || 0) + quantity;
        hasReceipt = true;
      }

      if (!hasReceipt) throw new Error('Enter at least one quantity to receive.');
      const isFullyReceived = items.every((item) => item.received_quantity >= item.quantity);
      await db.purchase_orders.update(order.id, {
        items_json: JSON.stringify(items),
        status: isFullyReceived ? 'received' : 'partially_received',
        received_at: isFullyReceived ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
        synced: 0,
      });
    }
  );
}

export async function cancelPurchaseOrder(orderId: string, storeId: string): Promise<void> {
  const order = await db.purchase_orders.get(orderId);
  if (!order || order.store_id !== storeId) throw new Error('Purchase order not found.');
  if (order.status !== 'ordered' && order.status !== 'partially_received') {
    throw new Error('Only open purchase orders can be cancelled.');
  }
  await db.purchase_orders.update(order.id, {
    status: 'cancelled',
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

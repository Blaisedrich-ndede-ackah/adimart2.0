import {
  db,
  generateId,
  type LocalPurchaseOrder,
  type LocalSupplier,
  type PurchaseOrderLine,
} from '@/lib/dexie';
import { queueStockReceipt } from '@/lib/stockApprovals';
import { recordActivity } from '@/lib/activityLog';

function isOrderQty(value: unknown, allowZero = false): boolean {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (allowZero ? n < 0 : n <= 0) return false;
  if (n > 50_000_000) return false;
  const rounded = Math.round(n * 1000) / 1000;
  return Math.abs(n - rounded) < 1e-6;
}

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
      isOrderQty((item as PurchaseOrderLine).quantity) &&
      Number.isFinite((item as PurchaseOrderLine).unit_cost) &&
      (item as PurchaseOrderLine).unit_cost >= 0 &&
      isOrderQty((item as PurchaseOrderLine).received_quantity, true) &&
      (item as PurchaseOrderLine).received_quantity <= (item as PurchaseOrderLine).quantity + 0.0001
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
  dueDate?: string | null;
}): Promise<void> {
  if (!params.supplierId) throw new Error('Choose a supplier.');
  if (params.items.length === 0) throw new Error('Add at least one product.');
  const lines = params.items.map((item) => {
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unit_cost);
    if (!item.product_id || !isOrderQty(quantity)) {
      throw new Error('Each order line needs a product and a positive quantity.');
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
    amount_paid: 0,
    due_date: params.dueDate ? params.dueDate.slice(0, 10) : null,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.purchase_orders.add(order);
}

export function purchaseLineOpenQuantity(line: PurchaseOrderLine): number {
  return Math.max(
    0,
    line.quantity - (Number(line.received_quantity) || 0) - (Number(line.pending_quantity) || 0)
  );
}

export async function receivePurchaseOrder(params: {
  orderId: string;
  storeId: string;
  locationId: string;
  userId: string;
  quantities: number[];
}): Promise<{ pending: number }> {
  const [order, location, user] = await Promise.all([
    db.purchase_orders.get(params.orderId),
    db.locations.get(params.locationId),
    db.users.get(params.userId),
  ]);
  if (!order || order.store_id !== params.storeId) throw new Error('Purchase order not found.');
  if (!location || location.store_id !== params.storeId) throw new Error('Location not found.');
  let pending = 0;
  await db.transaction(
    'rw',
    [db.purchase_orders, db.suppliers, db.products, db.locations, db.stock_receipt_requests],
    async () => {
      const fresh = await db.purchase_orders.get(params.orderId);
      if (!fresh || fresh.store_id !== params.storeId) throw new Error('Purchase order not found.');
      if (fresh.status !== 'ordered' && fresh.status !== 'partially_received') {
        throw new Error('Only open purchase orders can be received.');
      }
      const supplier = await db.suppliers.get(fresh.supplier_id);
      if (!supplier || supplier.store_id !== params.storeId) throw new Error('Supplier not found.');

      const items = parsePurchaseOrderLines(fresh.items_json);
      for (const [index, item] of items.entries()) {
        const open = purchaseLineOpenQuantity(item);
        const quantity = params.quantities[index] ?? open;
        if (!isOrderQty(quantity, true) || quantity > open + 0.0001) {
          throw new Error(`Enter a received quantity from 0 to ${open} for "${item.product_name}".`);
        }
        if (quantity === 0) continue;
        const product = await db.products.get(item.product_id);
        if (!product || product.store_id !== params.storeId) {
          throw new Error(`Product "${item.product_name}" is no longer in this store.`);
        }
        await queueStockReceipt({
          storeId: params.storeId,
          productId: item.product_id,
          productName: item.product_name,
          locationId: params.locationId,
          locationName: location.name,
          quantity,
          kind: 'purchase',
          note: `Purchase ${fresh.order_number} from ${supplier.name}`,
          batchCode: fresh.order_number,
          costPrice: item.unit_cost,
          sourceId: fresh.id,
          sourceLine: String(index),
          requestedBy: params.userId,
          requestedByName: user?.name || 'Staff',
        });
        item.pending_quantity = (Number(item.pending_quantity) || 0) + quantity;
        pending += 1;
      }

      if (pending === 0) throw new Error('Enter at least one quantity to receive.');
      await db.purchase_orders.update(fresh.id, {
        items_json: JSON.stringify(items),
        updated_at: new Date().toISOString(),
        synced: 0,
      });
    }
  );
  return { pending };
}

export async function settlePurchaseReceipt(
  request: { store_id: string; source_id: string | null; source_line: string | null; quantity: number },
  decision: 'approved' | 'rejected',
  actor?: { userId: string; userName: string; role?: string }
): Promise<void> {
  if (!request.source_id) return;
  const order = await db.purchase_orders.get(request.source_id);
  if (!order || order.store_id !== request.store_id) return;
  const items = parsePurchaseOrderLines(order.items_json);
  const line = items[Number(request.source_line)];
  if (!line) return;
  const waiting = Math.max(0, Number(line.pending_quantity) || 0);
  if (decision === 'approved') {
    line.received_quantity = (Number(line.received_quantity) || 0) + request.quantity;
    line.pending_quantity = Math.max(0, waiting - request.quantity);
    const product = await db.products.get(line.product_id);
    if (product && product.store_id === request.store_id) {
      const previousCost = Number(product.cost_price) || 0;
      await db.products.update(product.id, {
        cost_price: line.unit_cost,
        updated_at: new Date().toISOString(),
        synced: 0,
      });
      if (actor && Math.abs(previousCost - line.unit_cost) > 0.001) {
        recordActivity({
          storeId: request.store_id,
          userId: actor.userId,
          username: actor.userName,
          role: actor.role || 'owner',
          activityType: 'cost_change',
          summary: `${actor.userName} changed the cost of ${product.name}`,
          details: `Old cost ${previousCost.toFixed(2)} → new cost ${line.unit_cost.toFixed(2)} from purchase receipt`,
        });
      }
    }
  } else {
    line.pending_quantity = Math.max(0, waiting - request.quantity);
  }
  const fully = items.every((item) => (Number(item.received_quantity) || 0) >= item.quantity);
  const anyReceived = items.some((item) => (Number(item.received_quantity) || 0) > 0);
  const now = new Date().toISOString();
  await db.purchase_orders.update(order.id, {
    items_json: JSON.stringify(items),
    status: order.status === 'cancelled'
      ? 'cancelled'
      : fully
        ? 'received'
        : anyReceived
          ? 'partially_received'
          : 'ordered',
    received_at: fully ? now : order.received_at,
    updated_at: now,
    synced: 0,
  });
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

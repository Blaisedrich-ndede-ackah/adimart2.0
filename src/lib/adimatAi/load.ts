import { db, type LocalStore } from '@/lib/dexie';
import { resolveDebtReminderSettings } from '@/lib/debtReminders';
import { getDefaultShopLocationId, getExpiringBatches } from '@/lib/warehouse';
import { readAiSettings } from './settings';
import type { AiSettings, AiSnapshot } from './types';

const HISTORY_WEEKS = 16;

export interface LoadedSnapshot {
  snapshot: AiSnapshot;
  locations: { id: string; name: string }[];
  locationId: string | null;
}

export async function loadAiSnapshot(input: {
  storeId: string;
  locationId?: string | null;
  settings?: AiSettings;
  now?: Date;
}): Promise<LoadedSnapshot> {
  const now = input.now ?? new Date();
  const settings = input.settings ?? readAiSettings();
  const since = new Date(now);
  since.setDate(since.getDate() - HISTORY_WEEKS * 7);
  const sinceIso = since.toISOString();
  const store = await db.stores.get(input.storeId);
  const locationId = input.locationId || (await getDefaultShopLocationId(input.storeId));
  const [
    products,
    sales,
    items,
    batches,
    locations,
    movements,
    returns,
    customers,
    payments,
    reminders,
    orders,
    suppliers,
    expiring,
  ] = await Promise.all([
    db.products.where('store_id').equals(input.storeId).toArray(),
    db.transactions.where('store_id').equals(input.storeId).toArray(),
    db.transaction_items.where('store_id').equals(input.storeId).toArray(),
    db.stock_batches.where('store_id').equals(input.storeId).toArray(),
    db.locations.where('store_id').equals(input.storeId).toArray(),
    db.stock_movements.where('store_id').equals(input.storeId).toArray(),
    db.sales_returns.where('store_id').equals(input.storeId).toArray(),
    db.customers.where('store_id').equals(input.storeId).toArray(),
    db.credit_payments.where('store_id').equals(input.storeId).toArray(),
    db.debt_reminders.where('store_id').equals(input.storeId).toArray(),
    db.purchase_orders.where('store_id').equals(input.storeId).toArray(),
    db.suppliers.where('store_id').equals(input.storeId).toArray(),
    getExpiringBatches(input.storeId, settings.expiryDays, locationId || undefined),
  ]);

  const keptSales = sales.filter(
    (sale) => sale.created_at >= sinceIso || (sale.credit_balance || 0) > 0
  );
  const saleIds = new Set(keptSales.map((sale) => sale.id));
  const template = resolveDebtReminderSettings(store as LocalStore | undefined).messageTemplate;

  const snapshot: AiSnapshot = {
    now: now.toISOString(),
    storeName: store?.name || 'our store',
    locationId,
    expiringBatchIds: expiring.map((batch) => batch.id),
    debtTemplate: template,
    settings,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category || '',
      barcode: product.barcode || '',
      sellingPrice: Number(product.selling_price) || 0,
      costPrice: Number(product.cost_price) || 0,
      stock: Number(product.stock_level) || 0,
      reorderLevel: Number(product.reorder_level) || 0,
      active: product.is_active === 1,
    })),
    sales: keptSales.map((sale) => ({
      id: sale.id,
      createdAt: sale.created_at,
      cashierId: sale.cashier_id || '',
      cashierName: sale.cashier_name || '',
      total: Number(sale.total_amount) || 0,
      discount: Number(sale.discount_applied) || 0,
      status: sale.status,
      locationId: sale.location_id || null,
      customerId: sale.customer_id || null,
      creditBalance: Number(sale.credit_balance) || 0,
    })),
    items: items
      .filter((item) => saleIds.has(item.transaction_id))
      .map((item) => ({
        transactionId: item.transaction_id,
        productId: item.product_id,
        quantity: Number(item.quantity) || 0,
        subtotal: Number(item.subtotal) || 0,
      })),
    batches: batches.map((batch) => ({
      id: batch.id,
      productId: batch.product_id,
      locationId: batch.location_id,
      expiryDate: batch.expiry_date,
      quantity: Number(batch.quantity) || 0,
      costPrice: Number(batch.cost_price) || 0,
      createdAt: batch.created_at,
    })),
    locations: locations
      .filter((location) => location.is_active === 1)
      .map((location) => ({ id: location.id, name: location.name })),
    movements: movements
      .filter((movement) => movement.movement_type === 'adjust' && movement.created_at >= sinceIso)
      .map((movement) => ({
        productId: movement.product_id,
        type: movement.movement_type,
        quantity: Number(movement.quantity) || 0,
        userId: movement.user_id,
        createdAt: movement.created_at,
      })),
    returns: returns
      .filter((row) => row.created_at >= sinceIso)
      .map((row) => ({
        createdBy: row.created_by || '',
        createdAt: row.created_at,
        quantity: Number(row.quantity) || 0,
      })),
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone || '',
      openingRemaining: Number(customer.opening_balance_remaining) || 0,
      createdAt: customer.created_at,
      optOut: customer.debt_reminder_opt_out === 1,
    })),
    payments: payments
      .filter((payment) => payment.customer_id)
      .map((payment) => ({
        customerId: payment.customer_id || '',
        amount: Number(payment.amount) || 0,
        createdAt: payment.created_at,
      })),
    reminders: reminders.map((reminder) => ({
      customerId: reminder.customer_id,
      sentAt: reminder.sent_at || reminder.created_at,
    })),
    orders: orders.map((order) => ({
      supplierId: order.supplier_id,
      status: order.status,
      createdAt: order.created_at,
      lines: parseLines(order.items_json),
    })),
    suppliers: suppliers
      .filter((supplier) => supplier.is_active === 1)
      .map((supplier) => ({ id: supplier.id, name: supplier.name })),
  };

  return {
    snapshot,
    locations: snapshot.locations,
    locationId,
  };
}

function parseLines(json: string): { productId: string; quantity: number; received: number; unitCost: number }[] {
  try {
    const parsed = JSON.parse(json) as { product_id?: string; quantity?: number; received_quantity?: number; unit_cost?: number }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((line) => ({
      productId: line.product_id || '',
      quantity: Number(line.quantity) || 0,
      received: Number(line.received_quantity) || 0,
      unitCost: Number(line.unit_cost) || 0,
    }));
  } catch {
    return [];
  }
}

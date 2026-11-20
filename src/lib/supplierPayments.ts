import { db, generateId, type LocalPurchaseOrder, type LocalSupplier } from '@/lib/dexie';
import { recordActivity } from '@/lib/activityLog';
import { toMoneyAmount } from '@/lib/money';
import { isOverduePayable, payableBalance, receivedPayableValue } from '@/lib/payablesMath';
import { parsePurchaseOrderLines } from '@/lib/purchasing';

export type SupplierPayMethod = 'cash' | 'momo' | 'bank';

export interface SupplierPayable {
  order: LocalPurchaseOrder;
  supplierName: string;
  orderedValue: number;
  receivedValue: number;
  amountPaid: number;
  balance: number;
  dueDate: string | null;
  overdue: boolean;
}

export async function listSupplierPayables(storeId: string): Promise<SupplierPayable[]> {
  const [orders, suppliers] = await Promise.all([
    db.purchase_orders.where('store_id').equals(storeId).toArray(),
    db.suppliers.where('store_id').equals(storeId).toArray(),
  ]);
  const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  return orders
    .map((order) => describePayable(order, names.get(order.supplier_id) || 'Supplier'))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.balance - a.balance);
}

export function describePayable(order: LocalPurchaseOrder, supplierName: string): SupplierPayable {
  let lines: ReturnType<typeof parsePurchaseOrderLines> = [];
  try {
    lines = parsePurchaseOrderLines(order.items_json);
  } catch {
    lines = [];
  }
  const receivedValue = receivedPayableValue(lines);
  const amountPaid = toMoneyAmount(order.amount_paid || 0);
  const balance = payableBalance(receivedValue, amountPaid);
  const dueDate = order.due_date ? order.due_date.slice(0, 10) : null;
  return {
    order,
    supplierName,
    orderedValue: toMoneyAmount(order.total_amount),
    receivedValue,
    amountPaid,
    balance,
    dueDate,
    overdue: isOverduePayable({ balance, dueDate, status: order.status }),
  };
}

export async function supplierAmountOwed(storeId: string, supplierId: string): Promise<number> {
  const rows = await listSupplierPayables(storeId);
  return toMoneyAmount(
    rows
      .filter((row) => row.order.supplier_id === supplierId && row.order.status !== 'cancelled')
      .reduce((sum, row) => sum + row.balance, 0)
  );
}

export async function recordSupplierPayment(input: {
  storeId: string;
  supplierId: string;
  purchaseOrderId?: string | null;
  amount: number;
  method: SupplierPayMethod;
  note?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  storeName?: string;
}): Promise<void> {
  const amount = toMoneyAmount(input.amount);
  if (amount <= 0) throw new Error('Enter a payment amount greater than zero.');
  if (!['cash', 'momo', 'bank'].includes(input.method)) throw new Error('Choose cash, MoMo, or bank.');
  const supplier = await db.suppliers.get(input.supplierId);
  if (!supplier || supplier.store_id !== input.storeId) throw new Error('Supplier not found.');
  let order: LocalPurchaseOrder | undefined;
  if (input.purchaseOrderId) {
    order = await db.purchase_orders.get(input.purchaseOrderId);
    if (!order || order.store_id !== input.storeId || order.supplier_id !== supplier.id) {
      throw new Error('That purchase order is not for this supplier.');
    }
  }
  const now = new Date().toISOString();
  await db.transaction('rw', [db.supplier_payments, db.purchase_orders], async () => {
    await db.supplier_payments.add({
      id: generateId(),
      store_id: input.storeId,
      supplier_id: supplier.id,
      purchase_order_id: order?.id || null,
      amount,
      method: input.method,
      note: (input.note || '').trim(),
      paid_at: now,
      created_by: input.actorId,
      created_by_name: input.actorName,
      created_at: now,
      synced: 0,
    });
    if (order) {
      await db.purchase_orders.update(order.id, {
        amount_paid: toMoneyAmount((Number(order.amount_paid) || 0) + amount),
        updated_at: now,
        synced: 0,
      });
    }
  });
  recordActivity({
    storeId: input.storeId,
    storeName: input.storeName,
    userId: input.actorId,
    username: input.actorName,
    role: input.actorRole,
    activityType: 'supplier_payment',
    summary: `${input.actorName} paid ${supplier.name} ${amount.toFixed(2)} by ${input.method}`,
    details: order ? `${order.order_number}. ${input.note || ''}`.trim() : (input.note || ''),
  });
}

export async function setPurchaseOrderDueDate(orderId: string, storeId: string, dueDate: string): Promise<void> {
  const order = await db.purchase_orders.get(orderId);
  if (!order || order.store_id !== storeId) throw new Error('Purchase order not found.');
  const clean = dueDate.trim().slice(0, 10);
  if (clean && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error('Enter a valid due date.');
  await db.purchase_orders.update(order.id, {
    due_date: clean || null,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export function supplierStatement(input: {
  supplier: LocalSupplier;
  payables: SupplierPayable[];
  payments: Array<{ paid_at: string; amount: number; method: string; note: string; order_number?: string }>;
}): { owed: number; overdue: number; lines: string[] } {
  const mine = input.payables.filter((row) => row.order.supplier_id === input.supplier.id && row.order.status !== 'cancelled');
  const owed = toMoneyAmount(mine.reduce((sum, row) => sum + row.balance, 0));
  const overdue = toMoneyAmount(mine.filter((row) => row.overdue).reduce((sum, row) => sum + row.balance, 0));
  return { owed, overdue, lines: mine.map((row) => row.order.order_number) };
}

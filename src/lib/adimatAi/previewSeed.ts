import {
  db,
  generateId,
  type LocalCustomer,
  type LocalLocation,
  type LocalProduct,
  type LocalPurchaseOrder,
  type LocalSaleReturn,
  type LocalStockBatch,
  type LocalStockMovement,
  type LocalSupplier,
  type LocalTransaction,
  type LocalTransactionItem,
  type LocalCreditPayment,
} from '@/lib/dexie';

const BARCODE = 'ADIM-AI-';
const RECEIPT = 'AI-SEED-';

function daysAgo(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 10, 0, 0);
  return date.toISOString();
}

function ymdFromNow(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Local sample shop used to preview ADIMAT AI. Development only.
 * Rows are marked synced so a later cloud push does not upload them.
 */
export async function seedAdimatAiPreview(storeId: string): Promise<void> {
  const products = await db.products.where('store_id').equals(storeId).toArray();
  const oldProducts = products.filter((product) => (product.barcode || '').startsWith(BARCODE));
  const transactions = await db.transactions.where('store_id').equals(storeId).toArray();
  const oldSales = transactions.filter((sale) => (sale.receipt_number || '').startsWith(RECEIPT));
  const oldSaleIds = new Set(oldSales.map((sale) => sale.id));
  const items = await db.transaction_items.where('store_id').equals(storeId).toArray();
  const batches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const movements = await db.stock_movements.where('store_id').equals(storeId).toArray();
  const returns = await db.sales_returns.where('store_id').equals(storeId).toArray();
  const customers = await db.customers.where('store_id').equals(storeId).toArray();
  const payments = await db.credit_payments.where('store_id').equals(storeId).toArray();
  const suppliers = await db.suppliers.where('store_id').equals(storeId).toArray();
  const orders = await db.purchase_orders.where('store_id').equals(storeId).toArray();
  const locations = await db.locations.where('store_id').equals(storeId).toArray();

  await db.products.bulkDelete(oldProducts.map((product) => product.id));
  await db.transactions.bulkDelete(oldSales.map((sale) => sale.id));
  await db.transaction_items.bulkDelete(items.filter((item) => oldSaleIds.has(item.transaction_id)).map((item) => item.id));
  await db.stock_batches.bulkDelete(batches.filter((batch) => (batch.batch_code || '').startsWith(RECEIPT)).map((batch) => batch.id));
  await db.stock_movements.bulkDelete(movements.filter((row) => row.note === 'ADIM AI sample').map((row) => row.id));
  await db.sales_returns.bulkDelete(returns.filter((row) => row.reason === 'ADIM AI sample').map((row) => row.id));
  await db.customers.bulkDelete(customers.filter((row) => (row.phone || '').startsWith('02441111')).map((row) => row.id));
  await db.credit_payments.bulkDelete(payments.filter((row) => row.customer_id && customers.some((customer) => (customer.phone || '').startsWith('02441111') && customer.id === row.customer_id)).map((row) => row.id));
  await db.suppliers.bulkDelete(suppliers.filter((row) => row.name === 'Sample Wholesale').map((row) => row.id));
  await db.purchase_orders.bulkDelete(orders.filter((row) => (row.notes || '').includes('ADIM AI sample')).map((row) => row.id));

  const now = new Date().toISOString();
  let main = locations.find((location) => location.is_default === 1 && location.is_active === 1)
    || locations.find((location) => location.is_active === 1);
  if (!main) {
    main = {
      id: generateId(),
      store_id: storeId,
      name: 'Shop',
      location_type: 'shop',
      is_default: 1,
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 1,
    };
    await db.locations.add(main);
  }
  let osu = locations.find((location) => location.name === 'Sample Osu branch' && location.is_active === 1);
  if (!osu) {
    osu = {
      id: generateId(),
      store_id: storeId,
      name: 'Sample Osu branch',
      location_type: 'shop',
      is_default: 0,
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 1,
    } satisfies LocalLocation;
    await db.locations.add(osu);
  }

  const milo = product(storeId, 'Milo 400g', 'Drinks', `${BARCODE}MILO`, 8, 12, 24, 6);
  const peak = product(storeId, 'Peak Milk', 'Drinks', `${BARCODE}PEAK`, 8, 14, 18, 6);
  const indomie = product(storeId, 'Indomie Chicken', 'Food', `${BARCODE}INDOMIE`, 3, 5, 4, 12);
  const sugar = product(storeId, 'Sugar 1kg', 'Grocery', `${BARCODE}SUGAR`, 6, 9, 15, 4);
  const rice = product(storeId, 'Rice 5kg', 'Grocery', `${BARCODE}RICE`, 40, 55, 30, 4);
  const bread = product(storeId, 'Bread loaf', 'Bakery', `${BARCODE}BREAD`, 4, 8, 12, 4);
  const rows = [milo, peak, indomie, sugar, rice, bread];
  await db.products.bulkAdd(rows);

  const ama = 'seed-cashier-ama';
  const kofi = 'seed-cashier-kofi';
  const esi = 'seed-cashier-esi';
  const sales: LocalTransaction[] = [];
  const saleItems: LocalTransactionItem[] = [];
  let receipt = 1;
  const addSale = (
    days: number,
    hour: number,
    cashierId: string,
    cashierName: string,
    locationId: string,
    lines: { product: LocalProduct; qty: number; price: number }[],
    discount = 0,
    customerId: string | null = null,
    credit = 0
  ) => {
    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0) - discount;
    const id = generateId();
    sales.push({
      id,
      store_id: storeId,
      receipt_number: `${RECEIPT}${String(receipt).padStart(4, '0')}`,
      cashier_id: cashierId,
      cashier_name: cashierName,
      total_amount: total,
      discount_applied: discount,
      payment_method: credit > 0 ? 'cash' : 'cash',
      cash_amount: Math.max(0, total - credit),
      paystack_amount: 0,
      paystack_reference: '',
      status: 'completed',
      location_id: locationId,
      customer_id: customerId,
      credit_balance: credit,
      created_at: daysAgo(days, hour),
      synced: 1,
    });
    receipt += 1;
    for (const line of lines) {
      saleItems.push({
        id: generateId(),
        store_id: storeId,
        transaction_id: id,
        product_id: line.product.id,
        product_name: line.product.name,
        quantity: line.qty,
        unit_price: line.price,
        subtotal: line.price * line.qty,
        synced: 1,
      });
    }
    return id;
  };

  addSale(60, 11, esi, 'Esi Owusu', main.id, [{ product: milo, qty: 1, price: 12 }]);
  for (let day = 2; day <= 36; day += 1) {
    addSale(day, 11, esi, 'Esi Owusu', main.id, [
      { product: indomie, qty: 3, price: 5 },
      { product: milo, qty: 1, price: 12 },
      { product: sugar, qty: 1, price: 9 },
    ]);
    if (day % 2 === 0) {
      addSale(day, 15, esi, 'Esi Owusu', osu.id, [
        { product: rice, qty: 1, price: 55 },
        { product: peak, qty: 1, price: 14 },
      ]);
    }
  }
  addSale(1, 10, esi, 'Esi Owusu', main.id, [
    { product: milo, qty: 4, price: 12 },
    { product: peak, qty: 3, price: 14 },
    { product: sugar, qty: 2, price: 9 },
  ]);
  addSale(1, 16, esi, 'Esi Owusu', main.id, [{ product: indomie, qty: 6, price: 5 }]);
  for (let day = 20; day <= 34; day += 1) {
    addSale(day, 12, ama, 'Ama Mensah', main.id, [{ product: sugar, qty: 1, price: 100 }], 5);
  }
  for (let day = 1; day <= 5; day += 1) {
    addSale(day, 13, ama, 'Ama Mensah', main.id, [{ product: sugar, qty: 1, price: 100 }], 40);
  }
  for (let day = 21; day <= 32; day += 1) {
    addSale(day, 11, kofi, 'Kofi Boateng', main.id, [{ product: peak, qty: 1, price: 14 }]);
  }
  for (let day = 1; day <= 4; day += 1) {
    addSale(day, 22, kofi, 'Kofi Boateng', main.id, [{ product: bread, qty: 1, price: 8 }]);
  }

  const akosua: LocalCustomer = customer(storeId, 'Akosua Mensah', '0244111101');
  const yaw: LocalCustomer = customer(storeId, 'Yaw Boateng', '0244111102');
  const akosuaSale = addSale(25, 14, esi, 'Esi Owusu', main.id, [{ product: milo, qty: 2, price: 90 }], 0, akosua.id, 180);
  const yawSale = addSale(50, 14, esi, 'Esi Owusu', main.id, [{ product: sugar, qty: 1, price: 50 }], 0, yaw.id, 50);
  await db.customers.bulkAdd([akosua, yaw]);
  await db.transactions.bulkAdd(sales);
  await db.transaction_items.bulkAdd(saleItems);
  await db.credit_payments.bulkAdd([
    payment(storeId, akosua.id, akosuaSale, 20, 20),
    payment(storeId, yaw.id, yawSale, 10, 45),
  ] satisfies LocalCreditPayment[]);

  const breadBatch: LocalStockBatch = {
    id: generateId(),
    store_id: storeId,
    product_id: bread.id,
    location_id: main.id,
    batch_code: `${RECEIPT}BREAD`,
    expiry_date: ymdFromNow(5),
    quantity: 12,
    cost_price: 4,
    created_at: daysAgo(2, 9),
    updated_at: now,
    synced: 1,
  };
  const peakOld: LocalStockBatch = {
    id: generateId(),
    store_id: storeId,
    product_id: peak.id,
    location_id: main.id,
    batch_code: `${RECEIPT}PEAK-OLD`,
    expiry_date: ymdFromNow(80),
    quantity: 4,
    cost_price: 8,
    created_at: daysAgo(40, 9),
    updated_at: now,
    synced: 1,
  };
  const peakNew: LocalStockBatch = {
    id: generateId(),
    store_id: storeId,
    product_id: peak.id,
    location_id: main.id,
    batch_code: `${RECEIPT}PEAK-NEW`,
    expiry_date: ymdFromNow(120),
    quantity: 14,
    cost_price: 11,
    created_at: daysAgo(1, 9),
    updated_at: now,
    synced: 1,
  };
  const riceBatch: LocalStockBatch = {
    id: generateId(),
    store_id: storeId,
    product_id: rice.id,
    location_id: main.id,
    batch_code: `${RECEIPT}RICE`,
    expiry_date: ymdFromNow(200),
    quantity: 30,
    cost_price: 40,
    created_at: daysAgo(20, 9),
    updated_at: now,
    synced: 1,
  };
  await db.stock_batches.bulkAdd([breadBatch, peakOld, peakNew, riceBatch]);

  const supplier: LocalSupplier = {
    id: generateId(),
    store_id: storeId,
    name: 'Sample Wholesale',
    contact_name: 'Esi',
    phone: '0244111199',
    email: '',
    address: 'Makola',
    notes: '',
    is_active: 1,
    created_at: daysAgo(30, 9),
    updated_at: now,
    synced: 1,
  };
  const order: LocalPurchaseOrder = {
    id: generateId(),
    store_id: storeId,
    supplier_id: supplier.id,
    order_number: 'PO-AI-SEED',
    status: 'received',
    items_json: JSON.stringify([
      { product_id: indomie.id, product_name: indomie.name, quantity: 20, unit_cost: 3, received_quantity: 20 },
    ]),
    total_amount: 60,
    notes: 'ADIM AI sample',
    created_at: daysAgo(30, 9),
    updated_at: now,
    synced: 1,
  };
  await db.suppliers.add(supplier);
  await db.purchase_orders.add(order);

  const adjust: LocalStockMovement[] = [1, 2, 3].map((day) => ({
    id: generateId(),
    store_id: storeId,
    product_id: sugar.id,
    batch_id: null,
    from_location_id: main.id,
    to_location_id: null,
    movement_type: 'adjust',
    quantity: 1,
    note: 'ADIM AI sample',
    user_id: kofi,
    created_at: daysAgo(day, 18),
    synced: 1,
  }));
  await db.stock_movements.bulkAdd(adjust);
  const refunds: LocalSaleReturn[] = [1, 2, 3].map((day) => ({
    id: generateId(),
    store_id: storeId,
    transaction_id: sales[0].id,
    transaction_item_id: saleItems[0].id,
    product_id: bread.id,
    product_name: bread.name,
    quantity: 1,
    stock_quantity: 1,
    reason: 'ADIM AI sample',
    photo_data_url: '',
    receipt_number: `${RECEIPT}RET`,
    location_id: main.id,
    refund_method: 'cash',
    refund_amount: 8,
    debt_applied: 0,
    wallet_credit: 0,
    created_by: kofi,
    created_at: daysAgo(day, 19),
    synced: 1,
  }));
  await db.sales_returns.bulkAdd(refunds);
}

function product(
  storeId: string,
  name: string,
  category: string,
  barcode: string,
  cost: number,
  selling: number,
  stock: number,
  reorder: number
): LocalProduct {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    store_id: storeId,
    name,
    category,
    sku_type: 'simple',
    barcode,
    cost_price: cost,
    selling_price: selling,
    stock_level: stock,
    is_active: 1,
    reorder_level: reorder,
    created_at: now,
    updated_at: now,
    synced: 1,
  };
}

function customer(storeId: string, name: string, phone: string): LocalCustomer {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    store_id: storeId,
    name,
    phone,
    opening_balance: 0,
    opening_balance_remaining: 0,
    is_active: 1,
    created_at: daysAgo(90, 9),
    updated_at: now,
    synced: 1,
  };
}

function payment(storeId: string, customerId: string, transactionId: string, amount: number, days: number): LocalCreditPayment {
  return {
    id: generateId(),
    store_id: storeId,
    customer_id: customerId,
    transaction_id: transactionId,
    amount,
    payment_method: 'cash',
    created_by: 'seed',
    created_at: daysAgo(days, 17),
    synced: 1,
  };
}

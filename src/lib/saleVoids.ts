import {
  db,
  generateId,
  type LocalCustomer,
  type LocalTransaction,
  type LocalUser,
} from '@/lib/dexie';
import { recordActivity } from '@/lib/activityLog';
import { roundStockQty, roundStockQtyAllowZero } from '@/lib/measure';
import { toMoneyAmount } from '@/lib/money';

export async function requestOrVoidSale(input: {
  storeId: string;
  transactionId: string;
  reason: string;
  actor: Pick<LocalUser, 'id' | 'name' | 'role'>;
  storeName?: string;
}): Promise<'requested' | 'voided'> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('Enter a reason for the void (at least 3 characters).');
  if (input.actor.role === 'owner') {
    await voidCompletedSale(input);
    return 'voided';
  }
  await requestSaleVoid(input);
  return 'requested';
}

export async function requestSaleVoid(input: {
  storeId: string;
  transactionId: string;
  reason: string;
  actor: Pick<LocalUser, 'id' | 'name' | 'role'>;
  storeName?: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('Enter a reason for the void request.');
  const sale = await db.transactions.get(input.transactionId);
  if (!sale || sale.store_id !== input.storeId) throw new Error('Sale not found.');
  if (sale.status !== 'completed') throw new Error('Only a completed sale can be voided.');
  if (sale.void_status === 'voided') throw new Error('This sale is already voided.');
  if (sale.void_status === 'requested') throw new Error('A void request is already waiting for the owner.');
  const now = new Date().toISOString();
  await db.transactions.update(sale.id, {
    void_status: 'requested',
    void_reason: reason,
    void_requested_by: input.actor.id,
    void_requested_by_name: input.actor.name,
    void_requested_at: now,
    updated_at: now,
    synced: 0,
  });
  recordActivity({
    storeId: input.storeId,
    storeName: input.storeName,
    userId: input.actor.id,
    username: input.actor.name,
    role: input.actor.role,
    activityType: 'void_request',
    summary: `${input.actor.name} requested a void for ${sale.receipt_number}`,
    details: reason,
  });
}

export async function rejectSaleVoid(input: {
  storeId: string;
  transactionId: string;
  actor: Pick<LocalUser, 'id' | 'name' | 'role'>;
  storeName?: string;
}): Promise<void> {
  if (input.actor.role !== 'owner') throw new Error('Only the owner can decide a void request.');
  const sale = await db.transactions.get(input.transactionId);
  if (!sale || sale.store_id !== input.storeId) throw new Error('Sale not found.');
  if (sale.void_status !== 'requested') throw new Error('This sale has no open void request.');
  const now = new Date().toISOString();
  await db.transactions.update(sale.id, {
    void_status: 'none',
    void_reason: '',
    void_requested_by: null,
    void_requested_by_name: '',
    void_requested_at: null,
    updated_at: now,
    synced: 0,
  });
  recordActivity({
    storeId: input.storeId,
    storeName: input.storeName,
    userId: input.actor.id,
    username: input.actor.name,
    role: input.actor.role,
    activityType: 'void',
    summary: `${input.actor.name} rejected the void request for ${sale.receipt_number}`,
    details: 'Request cleared. The sale still counts.',
  });
}

export async function voidCompletedSale(input: {
  storeId: string;
  transactionId: string;
  reason: string;
  actor: Pick<LocalUser, 'id' | 'name' | 'role'>;
  storeName?: string;
}): Promise<void> {
  if (input.actor.role !== 'owner') throw new Error('Only the owner can void a sale. Ask them to approve the request.');
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('A void reason is required.');
  const sale = await db.transactions.get(input.transactionId);
  if (!sale || sale.store_id !== input.storeId) throw new Error('Sale not found.');
  if (sale.status !== 'completed') throw new Error('Only a completed sale can be voided.');
  if (sale.void_status === 'voided') throw new Error('This sale is already voided.');
  const returns = await db.sales_returns.where('transaction_id').equals(sale.id).toArray();
  if (returns.some((row) => row.store_id === input.storeId)) {
    throw new Error('This sale already has a return. Void is blocked so stock is not restored twice.');
  }
  const items = await db.transaction_items.where('transaction_id').equals(sale.id).toArray();
  const now = new Date().toISOString();
  const locationId = sale.location_id || (await defaultShopId(input.storeId));
  if (!locationId) throw new Error('This sale has no location, so stock cannot be restored.');

  await db.transaction(
    'rw',
    [
      db.transactions,
      db.stock_batches,
      db.stock_movements,
      db.products,
      db.product_variants,
      db.customers,
      db.customer_loyalty_transactions,
      db.customer_wallet_transactions,
    ],
    async () => {
      for (const item of items) {
        const qty = roundStockQty(item.base_quantity || item.quantity);
        if (qty <= 0 || !item.product_id) continue;
        const batchId = generateId();
        await db.stock_batches.add({
          id: batchId,
          store_id: input.storeId,
          product_id: item.product_id,
          location_id: locationId,
          variant_id: item.variant_id || null,
          batch_code: 'VOID',
          expiry_date: null,
          quantity: qty,
          cost_price: 0,
          created_at: now,
          updated_at: now,
          synced: 0,
        });
        await db.stock_movements.add({
          id: generateId(),
          store_id: input.storeId,
          product_id: item.product_id,
          batch_id: batchId,
          from_location_id: null,
          to_location_id: locationId,
          movement_type: 'adjust',
          quantity: qty,
          note: `Void sale ${sale.receipt_number}: ${reason}`,
          user_id: input.actor.id,
          created_at: now,
          synced: 0,
        });
        const product = await db.products.get(item.product_id);
        if (product) {
          await db.products.update(product.id, {
            stock_level: roundStockQtyAllowZero((Number(product.stock_level) || 0) + qty),
            updated_at: now,
            synced: 0,
          });
        }
        if (item.variant_id) {
          const variant = await db.product_variants.get(item.variant_id);
          if (variant) {
            await db.product_variants.update(variant.id, {
              stock_level: roundStockQtyAllowZero((Number(variant.stock_level) || 0) + qty),
              updated_at: now,
              synced: 0,
            });
          }
        }
      }
      if (sale.customer_id) {
        await reverseCustomerEffects(sale, input.actor.name, now);
      }
      await db.transactions.update(sale.id, {
        void_status: 'voided',
        void_reason: reason,
        voided_by: input.actor.id,
        voided_by_name: input.actor.name,
        voided_at: now,
        credit_balance: 0,
        updated_at: now,
        synced: 0,
      });
    }
  );

  recordActivity({
    storeId: input.storeId,
    storeName: input.storeName,
    userId: input.actor.id,
    username: input.actor.name,
    role: input.actor.role,
    activityType: 'void',
    summary: `${input.actor.name} voided sale ${sale.receipt_number}`,
    details: `Reason: ${reason}. Stock restored. Sale excluded from report totals.`,
  });
}

async function reverseCustomerEffects(sale: LocalTransaction, actorName: string, now: string): Promise<void> {
  const customer = await db.customers.get(sale.customer_id || '');
  if (!customer || customer.store_id !== sale.store_id) return;
  let points = Math.max(0, Math.floor(Number(customer.loyalty_points_balance) || 0));
  const redeemed = Math.max(0, Math.floor(Number(sale.loyalty_points_redeemed) || 0));
  const earned = Math.max(0, Math.floor(Number(sale.loyalty_points_earned) || 0));
  if (redeemed > 0) {
    points += redeemed;
    await db.customer_loyalty_transactions.add({
      id: generateId(),
      store_id: sale.store_id,
      customer_id: customer.id,
      transaction_id: sale.id,
      type: 'earn',
      points: redeemed,
      balance_after: points,
      reason: `Void restored redeemed points on ${sale.receipt_number}`,
      created_at: now,
      synced: 0,
    });
  }
  if (earned > 0) {
    const take = Math.min(points, earned);
    points -= take;
    if (take > 0) {
      await db.customer_loyalty_transactions.add({
        id: generateId(),
        store_id: sale.store_id,
        customer_id: customer.id,
        transaction_id: sale.id,
        type: 'redeem',
        points: take,
        balance_after: points,
        reason: `Void reversed points earned on ${sale.receipt_number}`,
        created_at: now,
        synced: 0,
      });
    }
  }
  const walletBack = toMoneyAmount(sale.wallet_amount || 0);
  let wallet = toMoneyAmount(customer.wallet_balance || 0);
  if (walletBack > 0) {
    wallet = toMoneyAmount(wallet + walletBack);
    await db.customer_wallet_transactions.add({
      id: generateId(),
      store_id: sale.store_id,
      customer_id: customer.id,
      type: 'refund',
      amount: walletBack,
      balance_after: wallet,
      transaction_id: sale.id,
      description: `Store credit restored after void ${sale.receipt_number}`,
      created_by: actorName,
      created_at: now,
      synced: 0,
    });
  }
  const patch: Partial<LocalCustomer> = {
    loyalty_points_balance: points,
    updated_at: now,
    synced: 0,
  };
  if (walletBack > 0) patch.wallet_balance = wallet;
  await db.customers.update(customer.id, patch);
}

async function defaultShopId(storeId: string): Promise<string | null> {
  const locations = await db.locations.where('store_id').equals(storeId).toArray();
  return (
    locations.find((location) => location.is_default === 1 && location.location_type === 'shop')?.id ||
    locations.find((location) => location.location_type === 'shop')?.id ||
    locations[0]?.id ||
    null
  );
}

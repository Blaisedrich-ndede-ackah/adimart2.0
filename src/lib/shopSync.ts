import { db } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

function missingTable(message: string): boolean {
  return /does not exist|PGRST205|schema cache/i.test(message || '');
}

async function pushRows(
  table: 'product_variants' | 'customer_loyalty_transactions' | 'supplier_payments' | 'store_promotions',
  rows: Record<string, unknown>[]
): Promise<number | 'missing'> {
  if (rows.length === 0 || !isSupabaseConfigured()) return 0;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) {
    if (missingTable(error.message)) return 'missing';
    throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/** Push the shop-extension tables. Missing cloud tables are skipped until the owner runs the migration. */
export async function pushShopExtensions(storeId: string): Promise<{ synced: number; error: string }> {
  try {
    let synced = 0;
    const variants = await db.product_variants.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
    const variantResult = await pushRows('product_variants', variants.map((row) => ({
      id: row.id,
      store_id: row.store_id,
      product_id: row.product_id,
      variant_name: row.variant_name,
      variant_value: row.variant_value,
      sku: row.sku || '',
      barcode: row.barcode || '',
      price_adjustment: row.price_adjustment || 0,
      stock_level: row.stock_level || 0,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })));
    if (typeof variantResult === 'number') {
      synced += variantResult;
      if (variantResult > 0) {
        await Promise.all(variants.map((row) => db.product_variants.update(row.id, { synced: 1 })));
      }
    }

    const loyalty = await db.customer_loyalty_transactions.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
    const loyaltyResult = await pushRows('customer_loyalty_transactions', loyalty.map((row) => ({
      id: row.id,
      store_id: row.store_id,
      customer_id: row.customer_id,
      transaction_id: row.transaction_id,
      type: row.type,
      points: row.points,
      balance_after: row.balance_after,
      reason: row.reason || '',
      created_at: row.created_at,
    })));
    if (typeof loyaltyResult === 'number') {
      synced += loyaltyResult;
      if (loyaltyResult > 0) {
        await Promise.all(loyalty.map((row) => db.customer_loyalty_transactions.update(row.id, { synced: 1 })));
      }
    }

    const payments = await db.supplier_payments.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
    const paymentResult = await pushRows('supplier_payments', payments.map((row) => ({
      id: row.id,
      store_id: row.store_id,
      supplier_id: row.supplier_id,
      purchase_order_id: row.purchase_order_id,
      amount: row.amount,
      method: row.method,
      note: row.note || '',
      paid_at: row.paid_at,
      created_by: row.created_by,
      created_by_name: row.created_by_name || '',
      created_at: row.created_at,
    })));
    if (typeof paymentResult === 'number') {
      synced += paymentResult;
      if (paymentResult > 0) {
        await Promise.all(payments.map((row) => db.supplier_payments.update(row.id, { synced: 1 })));
      }
    }

    const promos = await db.store_promotions.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
    const promoResult = await pushRows('store_promotions', promos.map((row) => ({
      id: row.id,
      store_id: row.store_id,
      name: row.name,
      promo_type: row.promo_type,
      product_id: row.product_id,
      category: row.category || '',
      sale_price: row.sale_price || 0,
      percent_off: row.percent_off || 0,
      amount_off: row.amount_off || 0,
      buy_quantity: row.buy_quantity || 0,
      free_quantity: row.free_quantity || 0,
      coupon_code: row.coupon_code || '',
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })));
    if (typeof promoResult === 'number') {
      synced += promoResult;
      if (promoResult > 0) {
        await Promise.all(promos.map((row) => db.store_promotions.update(row.id, { synced: 1 })));
      }
    }
    return { synced, error: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (missingTable(message)) return { synced: 0, error: '' };
    return { synced: 0, error: message };
  }
}

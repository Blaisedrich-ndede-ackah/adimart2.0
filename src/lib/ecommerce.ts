/**
 * E-commerce storefront helpers: public catalog, share links, online orders.
 */

import {
  db,
  generateId,
  type LocalOnlineOrder,
  type LocalOnlineOrderItem,
  type LocalProduct,
  type LocalStore,
  type LocalUser,
  type OnlineOrderStatus,
} from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface PublicShopProduct {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  stock_level: number;
  image_url: string;
  in_stock: boolean;
}

export interface PublicShopCatalog {
  store: {
    id: string;
    name: string;
    address: string;
    support_number: string;
    logo_url: string;
    tagline: string;
    slug: string;
  };
  products: PublicShopProduct[];
}

export interface OnlineCartItem {
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  image_url?: string;
}

export function canManageEcommerce(
  user: LocalUser | null | undefined,
  store: LocalStore | null | undefined
): boolean {
  if (!user || !store) return false;
  if ((store.ecommerce_enabled ?? 0) !== 1) return false;
  if (user.role === 'owner') return true;
  return (user.can_manage_ecommerce ?? 0) === 1;
}

export function slugifyStoreName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'store';
}

export function getPublicShopPath(slug: string): string {
  return `#/shop/${slug}`;
}

export function getPublicShopShareUrl(slug: string): string {
  if (typeof window === 'undefined') return getPublicShopPath(slug);
  return `${window.location.origin}${window.location.pathname}${getPublicShopPath(slug)}`;
}

export async function ensureEcommerceSlug(storeId: string): Promise<string> {
  const store = await db.stores.get(storeId);
  if (!store) throw new Error('Store not found');
  if (store.ecommerce_slug?.trim()) return store.ecommerce_slug.trim();

  let base = slugifyStoreName(store.name);
  let candidate = base;
  let n = 1;

  while (true) {
    if (isSupabaseConfigured()) {
      const { data } = await supabase
        .from('stores')
        .select('id')
        .eq('ecommerce_slug', candidate)
        .maybeSingle();
      if (!data || data.id === storeId) break;
    } else {
      break;
    }
    n += 1;
    candidate = `${base}-${n}`;
  }

  await db.stores.update(storeId, {
    ecommerce_slug: candidate,
    synced: 0,
  });
  return candidate;
}

export async function listOnlineCatalogProducts(storeId: string): Promise<LocalProduct[]> {
  const products = await db.products
    .where('store_id')
    .equals(storeId)
    .and((p) => p.is_active === 1)
    .toArray();
  products.sort((a, b) => a.name.localeCompare(b.name));
  return products;
}

export async function setProductSellOnline(
  productId: string,
  sellOnline: boolean
): Promise<void> {
  await db.products.update(productId, {
    sell_online: sellOnline ? 1 : 0,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function updateEcommerceTagline(storeId: string, tagline: string): Promise<void> {
  await db.stores.update(storeId, {
    ecommerce_tagline: tagline.trim(),
    synced: 0,
  });
}

function generateOrderNumber(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const rand = Math.floor(Math.random() * 900 + 100);
  return `ON-${stamp}-${rand}`;
}

/** Public: load catalog from Supabase by slug */
export async function fetchPublicShopCatalog(slug: string): Promise<PublicShopCatalog> {
  if (!isSupabaseConfigured()) {
    throw new Error('Online shop requires cloud connection. Configure Supabase.');
  }

  const clean = slug.trim().toLowerCase();
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id, name, address, support_number, logo_url, ecommerce_enabled, ecommerce_slug, ecommerce_tagline')
    .eq('ecommerce_slug', clean)
    .maybeSingle();

  if (storeError) throw new Error(storeError.message);
  if (!store || !store.ecommerce_enabled) {
    throw new Error('This shop is not available online.');
  }

  const { data: products, error: productError } = await supabase
    .from('products')
    .select('id, name, category, selling_price, stock_level, image_url, is_active, sell_online')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .eq('sell_online', true)
    .order('name');

  if (productError) throw new Error(productError.message);

  return {
    store: {
      id: store.id,
      name: store.name,
      address: store.address || '',
      support_number: store.support_number || '',
      logo_url: store.logo_url || '',
      tagline: store.ecommerce_tagline || 'Shop online',
      slug: store.ecommerce_slug || clean,
    },
    products: (products || []).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || 'Other',
      selling_price: Number(p.selling_price) || 0,
      stock_level: Number(p.stock_level) || 0,
      image_url: p.image_url || '',
      in_stock: (Number(p.stock_level) || 0) > 0,
    })),
  };
}

/** Public: place an order into Supabase */
export async function placePublicOnlineOrder(params: {
  storeId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  notes?: string;
  items: OnlineCartItem[];
}): Promise<{ orderId: string; orderNumber: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Online shop requires cloud connection.');
  }
  if (!params.customerName.trim()) throw new Error('Enter your name');
  if (!params.customerPhone.trim()) throw new Error('Enter your phone number');
  if (!params.items.length) throw new Error('Your cart is empty');

  const orderId = generateId();
  const orderNumber = generateOrderNumber();
  const now = new Date().toISOString();
  const total = params.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const { error: orderError } = await supabase.from('online_orders').insert({
    id: orderId,
    store_id: params.storeId,
    order_number: orderNumber,
    customer_name: params.customerName.trim(),
    customer_phone: params.customerPhone.trim(),
    customer_address: (params.customerAddress || '').trim(),
    notes: (params.notes || '').trim(),
    status: 'new',
    payment_method: 'pay_on_delivery',
    total_amount: Math.round(total * 100) / 100,
    created_at: now,
    updated_at: now,
  });

  if (orderError) {
    throw new Error(
      orderError.message.includes('online_orders')
        ? `${orderError.message} — run supabase-migrate-ecommerce.sql`
        : orderError.message
    );
  }

  const itemRows = params.items.map((item) => ({
    id: generateId(),
    store_id: params.storeId,
    order_id: orderId,
    product_id: item.product_id,
    product_name: item.product_name,
    unit_price: item.unit_price,
    quantity: item.quantity,
    subtotal: Math.round(item.unit_price * item.quantity * 100) / 100,
    created_at: now,
  }));

  const { error: itemsError } = await supabase.from('online_order_items').insert(itemRows);
  if (itemsError) {
    throw new Error(itemsError.message);
  }

  return { orderId, orderNumber };
}

export async function listLocalOnlineOrders(storeId: string): Promise<LocalOnlineOrder[]> {
  const orders = await db.online_orders.where('store_id').equals(storeId).toArray();
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return orders;
}

export async function listLocalOnlineOrderItems(
  storeId: string,
  orderId: string
): Promise<LocalOnlineOrderItem[]> {
  return db.online_order_items
    .where('store_id')
    .equals(storeId)
    .and((i) => i.order_id === orderId)
    .toArray();
}

export async function updateOnlineOrderStatus(
  orderId: string,
  status: OnlineOrderStatus
): Promise<void> {
  const now = new Date().toISOString();
  await db.online_orders.update(orderId, {
    status,
    updated_at: now,
    synced: 0,
  });

  if (isSupabaseConfigured()) {
    await supabase
      .from('online_orders')
      .update({ status, updated_at: now })
      .eq('id', orderId);
  }
}

export async function pullOnlineOrdersFromCloud(storeId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const { data: orders, error } = await supabase
    .from('online_orders')
    .select('*')
    .eq('store_id', storeId);

  if (error || !orders) return 0;

  let count = 0;
  for (const row of orders) {
    const local = await db.online_orders.get(row.id);
    if (local?.synced === 0) {
      const remoteTime = new Date(row.updated_at || row.created_at).getTime();
      const localTime = new Date(local.updated_at).getTime();
      if (localTime > remoteTime) continue;
    }
    await db.online_orders.put({
      id: row.id,
      store_id: row.store_id,
      order_number: row.order_number,
      customer_name: row.customer_name || '',
      customer_phone: row.customer_phone || '',
      customer_address: row.customer_address || '',
      notes: row.notes || '',
      status: row.status || 'new',
      payment_method: row.payment_method || 'pay_on_delivery',
      total_amount: Number(row.total_amount) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
      synced: 1,
    });
    count += 1;
  }

  const { data: items } = await supabase
    .from('online_order_items')
    .select('*')
    .eq('store_id', storeId);

  for (const row of items || []) {
    await db.online_order_items.put({
      id: row.id,
      store_id: row.store_id,
      order_id: row.order_id,
      product_id: row.product_id || null,
      product_name: row.product_name || '',
      unit_price: Number(row.unit_price) || 0,
      quantity: Number(row.quantity) || 0,
      subtotal: Number(row.subtotal) || 0,
      created_at: row.created_at,
      synced: 1,
    });
  }

  return count;
}

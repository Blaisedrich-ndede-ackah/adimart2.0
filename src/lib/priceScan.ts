import { db, type LocalProduct } from '@/lib/dexie';
import { getBarcodeCandidates } from '@/lib/barcodeUtils';
import { formatStoreMoney } from '@/lib/currency';
import type { AppLanguage } from '@/lib/i18n';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const PORTAL_ENABLED_KEY = 'adimat_price_scan_enabled';
const STORE_CACHE_PREFIX = 'adimat_price_scan_store:';

export interface PriceScanStore {
  id: string;
  name: string;
  logo_url: string;
  currency_code: string;
}

export interface ScanResult {
  product: LocalProduct;
  source: 'live' | 'cached';
}

export type SimilarProduct = LocalProduct;

export function buildPriceScanUrl(storeSlug: string): string {
  const slug = encodeURIComponent(storeSlug.trim().toLowerCase());
  const route = `#/price-scan/${slug}`;
  if (typeof window === 'undefined') return route;
  return `${window.location.origin}${window.location.pathname}${route}`;
}

export function isPriceScanPortalEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(PORTAL_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPriceScanPortalEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PORTAL_ENABLED_KEY, String(enabled));
  } catch {
    // The local setting remains optional when browser storage is unavailable.
  }
}

export async function resolvePriceScanStore(slug: string): Promise<PriceScanStore | null> {
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) return null;

  const localStore = await db.stores
    .filter((store) => (store.ecommerce_slug || '').trim().toLowerCase() === cleanSlug)
    .first();
  if (localStore) {
    const result = {
      id: localStore.id,
      name: localStore.name,
      logo_url: localStore.logo_url || '',
      currency_code: localStore.currency_code || 'GHS',
    };
    persistStoreCache(cleanSlug, result);
    return result;
  }

  if (isOnline() && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, logo_url, currency_code, ecommerce_slug')
        .eq('ecommerce_slug', cleanSlug)
        .maybeSingle();
      if (!error && data) {
        const row: unknown = data;
        if (isRecord(row) && stringValue(row.id) && stringValue(row.name)) {
          const result: PriceScanStore = {
            id: stringValue(row.id),
            name: stringValue(row.name),
            logo_url: stringValue(row.logo_url),
            currency_code: stringValue(row.currency_code) || 'GHS',
          };
          persistStoreCache(cleanSlug, result);
          return result;
        }
      }
    } catch {
      // Try this device's cached store data below.
    }
  }

  return readStoreCache(cleanSlug);
}

export async function lookupProductByBarcode(storeId: string, barcode: string): Promise<LocalProduct | null> {
  const result = await lookupProductByBarcodeWithSource(storeId, barcode);
  return result?.product || null;
}

export async function lookupProductByBarcodeWithSource(
  storeId: string,
  barcode: string
): Promise<ScanResult | null> {
  const cleanBarcode = barcode.trim();
  if (!storeId || !cleanBarcode) return null;
  const barcodeCandidates = getBarcodeCandidates(cleanBarcode);

  if (isOnline() && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, store_id, name, category, sku_type, barcode, selling_price, stock_level, is_active, image_url, reorder_level, created_at, updated_at')
        .eq('store_id', storeId)
        .in('barcode', barcodeCandidates)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        const row: unknown = data;
        if (isRecord(row)) {
          const liveProduct = mapPublicProduct(row);
          await cacheProduct(liveProduct);
          return { product: liveProduct, source: 'live' };
        }
      }
    } catch {
      // Use the IndexedDB copy when the online lookup is unavailable.
    }
  }

  const product = await db.products
    .where('store_id')
    .equals(storeId)
    .filter((row) => row.is_active === 1 && barcodeCandidates.includes(row.barcode.trim()))
    .first();
  return product ? { product, source: 'cached' } : null;
}

export async function getSimilarProducts(
  storeId: string,
  productId: string,
  category: string,
  limit = 6
): Promise<SimilarProduct[]> {
  const maxItems = Math.max(0, Math.min(6, Math.floor(limit)));
  if (!storeId || !category.trim() || maxItems === 0) return [];

  if (isOnline() && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, store_id, name, category, sku_type, barcode, selling_price, stock_level, is_active, image_url, reorder_level, created_at, updated_at')
        .eq('store_id', storeId)
        .eq('category', category)
        .eq('is_active', true)
        .neq('id', productId)
        .order('name')
        .limit(maxItems);
      if (!error && Array.isArray(data)) {
        const rows = data as unknown[];
        const products = rows.filter(isRecord).map(mapPublicProduct);
        await Promise.all(products.map(cacheProduct));
        return products;
      }
    } catch {
      // Fall back to products already cached in IndexedDB.
    }
  }

  const products = await db.products
    .where('store_id')
    .equals(storeId)
    .filter((product) => product.is_active === 1 && product.category === category && product.id !== productId)
    .toArray();
  return products.sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxItems);
}

export async function flushPendingPickupOrders(storeId: string): Promise<number> {
  if (!storeId || !isOnline() || !isSupabaseConfigured()) return 0;
  const pendingOrders = await db.online_orders
    .where('store_id')
    .equals(storeId)
    .filter((order) => order.synced === 0 && order.order_number.startsWith('PS-'))
    .toArray();
  let syncedCount = 0;
  for (const order of pendingOrders) {
    try {
      const items = await db.online_order_items
        .where('store_id')
        .equals(storeId)
        .filter((item) => item.order_id === order.id)
        .toArray();
      const { error: orderError } = await supabase.from('online_orders').upsert({
        id: order.id,
        store_id: order.store_id,
        order_number: order.order_number,
        customer_name: '',
        customer_phone: '',
        customer_address: '',
        notes: '',
        status: order.status,
        payment_method: order.payment_method,
        total_amount: order.total_amount,
        created_at: order.created_at,
        updated_at: order.updated_at,
      }, { onConflict: 'id' });
      if (orderError) continue;
      const { error: itemsError } = await supabase.from('online_order_items').upsert(items.map((item) => ({
        id: item.id,
        store_id: item.store_id,
        order_id: item.order_id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        subtotal: item.subtotal,
        created_at: item.created_at,
      })), { onConflict: 'id' });
      if (itemsError) continue;
      await db.transaction('rw', [db.online_orders, db.online_order_items], async () => {
        await db.online_orders.update(order.id, { synced: 1 });
        await Promise.all(items.map((item) => db.online_order_items.update(item.id, { synced: 1 })));
      });
      syncedCount += 1;
    } catch {
      // Leave this pickup order queued for the next online retry.
    }
  }
  return syncedCount;
}

export function formatMoney(amount: number, currency: string, language: AppLanguage): string {
  return formatStoreMoney(amount, currency, language);
}

function mapPublicProduct(row: Record<string, unknown>): LocalProduct {
  const now = new Date().toISOString();
  return {
    id: stringValue(row.id),
    store_id: stringValue(row.store_id),
    name: stringValue(row.name),
    category: stringValue(row.category) || 'Other',
    sku_type: stringValue(row.sku_type) || 'unit',
    barcode: stringValue(row.barcode),
    cost_price: 0,
    selling_price: numberValue(row.selling_price),
    stock_level: numberValue(row.stock_level),
    is_active: row.is_active === false ? 0 : 1,
    image_url: stringValue(row.image_url),
    reorder_level: numberValue(row.reorder_level) || 5,
    created_at: stringValue(row.created_at) || now,
    updated_at: stringValue(row.updated_at) || now,
    synced: 1,
  };
}

async function cacheProduct(product: LocalProduct): Promise<void> {
  const local = await db.products.get(product.id);
  if (!local || local.synced !== 0) {
    await db.products.put({ ...product, cost_price: local?.cost_price || 0, synced: 1 });
  }
}

function persistStoreCache(slug: string, store: PriceScanStore): void {
  try {
    window.localStorage.setItem(`${STORE_CACHE_PREFIX}${slug}`, JSON.stringify(store));
  } catch {
    // IndexedDB lookup remains available on this device.
  }
}

function readStoreCache(slug: string): PriceScanStore | null {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(`${STORE_CACHE_PREFIX}${slug}`) || 'null');
    if (!isRecord(stored) || !stringValue(stored.id) || !stringValue(stored.name)) return null;
    return {
      id: stringValue(stored.id),
      name: stringValue(stored.name),
      logo_url: stringValue(stored.logo_url),
      currency_code: stringValue(stored.currency_code) || 'GHS',
    };
  } catch {
    return null;
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

import Dexie, { Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import { isSupabaseConfigured, supabase, testSupabaseConnection } from './supabase';
import { toMoneyAmount } from './money';
import { formatUnknownError, isUuid, uuidOrNull } from './ids';

// Store represents a business/shop
export interface LocalStore {
  id: string;
  name: string;
  address: string;
  support_number: string;
  discount_cap_percentage: number;
  pin_on_discount_enabled: number;
  /** Allow percentage discounts at checkout (0/1) */
  discount_allow_percentage?: number;
  /** Allow fixed-amount discounts at checkout (0/1) */
  discount_allow_fixed?: number;
  /** Allow cashiers to apply discounts (0/1); owners always can */
  cashier_can_discount?: number;
  /** Preferred Mobile Money account name for Paystack payouts */
  momo_account_name: string;
  /** Preferred Mobile Money number (e.g. 024XXXXXXX) */
  momo_number: string;
  /** Network hint: MTN | Vodafone | AirtelTigo | Other */
  momo_network: string;
  /** Admin-managed subscription period start (ISO); pulled from cloud */
  subscription_started_at?: string | null;
  /** Admin-managed subscription expiry (ISO); pulled from cloud */
  subscription_expires_at?: string | null;
  /** Cumulative months granted by admin */
  subscription_months_granted?: number;
  /** Optional compressed JPEG data URL for store logo */
  logo_url?: string;
  warehouse_enabled?: number;
  max_shops?: number;
  max_warehouses?: number;
  /** Admin-managed cap on how many business stores this owner may create */
  max_stores?: number;
  /** Admin-granted public e-commerce storefront */
  ecommerce_enabled?: number;
  /** Public URL slug: #/shop/{slug} */
  ecommerce_slug?: string;
  ecommerce_tagline?: string;
  created_at: string;
  synced: number;
}

export interface LocalUser {
  id: string;
  store_id: string; // Links user to a store
  name: string;
  role: 'owner' | 'cashier';
  pin_hash: string;
  is_active: number;
  /** Ghana phone for SMS PIN reset / multi-store identity */
  phone?: string;
  assigned_location_id?: string | null;
  can_wholesale?: number;
  can_sell_from_warehouse?: number;
  /** Staff may manage online catalog/orders when ecommerce is enabled */
  can_manage_ecommerce?: number;
  created_at: string;
  synced: number;
}

export interface LocalProduct {
  id: string;
  store_id: string; // Links product to a store
  name: string;
  category: string;
  sku_type: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  stock_level: number;
  is_active: number;
  /** Optional compressed JPEG data URL for product photo */
  image_url?: string;
  pack_size?: number;
  track_expiry?: number;
  wholesale_mode?: string;
  wholesale_pack_price?: number;
  wholesale_unit_price?: number;
  wholesale_tiers_json?: string;
  /** List this product on the public e-commerce storefront */
  sell_online?: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export type OnlineOrderStatus = 'new' | 'confirmed' | 'fulfilled' | 'cancelled';

export interface LocalOnlineOrder {
  id: string;
  store_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  notes: string;
  status: OnlineOrderStatus;
  payment_method: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalOnlineOrderItem {
  id: string;
  store_id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  created_at: string;
  synced: number;
}

export interface LocalTransaction {
  id: string;
  store_id: string; // Links transaction to a store
  receipt_number: string;
  cashier_id: string;
  cashier_name: string;
  total_amount: number;
  discount_applied: number;
  payment_method: 'cash' | 'split' | 'paystack';
  cash_amount: number;
  paystack_amount: number;
  paystack_reference: string;
  status: 'completed' | 'pending';
  location_id?: string;
  sale_mode?: 'retail' | 'wholesale';
  created_at: string;
  synced: number;
}

export interface LocalTransactionItem {
  id: string;
  store_id: string;
  transaction_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  unit_type?: string;
  pack_size?: number;
  base_quantity?: number;
  batch_id?: string;
  synced: number;
}

export interface LocalLocation {
  id: string;
  store_id: string;
  name: string;
  location_type: 'shop' | 'warehouse';
  is_default: number;
  is_active: number;
  /** PIN hash required to open/manage warehouse from Settings */
  access_pin_hash?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalStockBatch {
  id: string;
  store_id: string;
  product_id: string;
  location_id: string;
  batch_code: string;
  expiry_date: string | null;
  quantity: number;
  cost_price: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalStockMovement {
  id: string;
  store_id: string;
  product_id: string;
  batch_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  movement_type: 'receive' | 'transfer' | 'sale' | 'adjust';
  quantity: number;
  note: string;
  user_id: string | null;
  created_at: string;
  synced: number;
}

export interface LocalExpense {
  id: string;
  store_id: string;
  description: string;
  category: string;
  amount: number;
  notes: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

/** Store cash book ledger (manual income / expense entries) */
export interface LocalCashBookEntry {
  id: string;
  store_id: string;
  entry_type: 'income' | 'expense';
  description: string;
  category: string;
  amount: number;
  notes: string;
  /** YYYY-MM-DD for range filters */
  entry_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface SyncMeta {
  id: string;
  last_synced_at: string;
}

export interface AppConfig {
  id: string;
  current_store_id: string | null;
  current_user_id: string | null;
}

/** Tombstones so cloud sync cannot resurrect hard-deleted records */
export interface LocalDeletedRecord {
  id: string;
  store_id: string;
  table_name: 'products';
  record_id: string;
  deleted_at: string;
  synced: number;
}

class AdimatDB extends Dexie {
  stores!: Table<LocalStore, string>;
  users!: Table<LocalUser, string>;
  products!: Table<LocalProduct, string>;
  transactions!: Table<LocalTransaction, string>;
  transaction_items!: Table<LocalTransactionItem, string>;
  expenses!: Table<LocalExpense, string>;
  cash_book_entries!: Table<LocalCashBookEntry, string>;
  locations!: Table<LocalLocation, string>;
  stock_batches!: Table<LocalStockBatch, string>;
  stock_movements!: Table<LocalStockMovement, string>;
  online_orders!: Table<LocalOnlineOrder, string>;
  online_order_items!: Table<LocalOnlineOrderItem, string>;
  deleted_records!: Table<LocalDeletedRecord, string>;
  sync_meta!: Table<SyncMeta, string>;
  app_config!: Table<AppConfig, string>;

  constructor() {
    super('AdimatPOS');
    this.version(2).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(3).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(4).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(5).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(6).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(7).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      cash_book_entries: 'id, store_id, entry_type, entry_date, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
  }
}

export const db = new AdimatDB();

export function generateReceiptNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `#ADM-${y}${m}${d}-${seq}`;
}

export function generateId(): string {
  return uuidv4();
}

export function hashPin(pin: string): string {
  let hash = 0;
  const str = `adimat_salt_${pin}_pos`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Get current store ID from app config
export async function getCurrentStoreId(): Promise<string | null> {
  const config = await db.app_config.get('main');
  return config?.current_store_id ?? null;
}

// Set current store ID
export async function setCurrentStoreId(storeId: string | null): Promise<void> {
  await db.app_config.put({
    id: 'main',
    current_store_id: storeId,
    current_user_id: null,
  });
}

export async function setCurrentUserId(userId: string | null): Promise<void> {
  const config = await db.app_config.get('main');
  await db.app_config.put({
    id: 'main',
    current_store_id: config?.current_store_id ?? null,
    current_user_id: userId,
  });
}

export async function getCurrentUserId(): Promise<string | null> {
  const config = await db.app_config.get('main');
  return config?.current_user_id ?? null;
}

/** Restore the last signed-in user for the current store (survives page refresh). */
export async function getPersistedCurrentUser(): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  const userId = await getCurrentUserId();
  if (!storeId || !userId) return null;
  const user = await db.users.get(userId);
  if (!user || user.store_id !== storeId) {
    await setCurrentUserId(null);
    return null;
  }
  return user;
}

// Get current store
export async function getCurrentStore(): Promise<LocalStore | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  const store = await db.stores.get(storeId);
  return store ?? null;
}

// Check if any store exists (first-time setup check)
export async function hasAnyStore(): Promise<boolean> {
  const count = await db.stores.count();
  return count > 0;
}

/** All stores present on this device (multi-store support). */
export async function listLocalStores(): Promise<LocalStore[]> {
  const stores = await db.stores.toArray();
  stores.sort((a, b) => a.name.localeCompare(b.name));
  return stores;
}

/**
 * Switch the active store on this device. Caller should clear the logged-in user
 * so staff sign in under the selected store.
 */
export async function switchToStore(storeId: string): Promise<LocalStore> {
  const store = await db.stores.get(storeId);
  if (!store) throw new Error('Store not found on this device');
  await setCurrentStoreId(storeId);
  return store;
}

// Create a new store with owner
export async function createStoreWithOwner(
  storeName: string,
  ownerName: string,
  ownerPin: string,
  profile?: { address?: string; supportNumber?: string; ownerPhone?: string }
): Promise<{ store: LocalStore; owner: LocalUser }> {
  const storeId = generateId();
  const ownerId = generateId();
  const now = new Date().toISOString();
  const ownerPhone = (profile?.ownerPhone || profile?.supportNumber || '').trim();

  const store: LocalStore = {
    id: storeId,
    name: storeName,
    address: (profile?.address || '').trim(),
    support_number: (profile?.supportNumber || '').trim(),
    discount_cap_percentage: 10,
    pin_on_discount_enabled: 1,
    discount_allow_percentage: 1,
    discount_allow_fixed: 1,
    cashier_can_discount: 1,
    momo_account_name: '',
    momo_number: '',
    momo_network: '',
    subscription_started_at: null,
    subscription_expires_at: null,
    subscription_months_granted: 0,
    logo_url: '',
    warehouse_enabled: 0,
    max_shops: 1,
    max_warehouses: 0,
    max_stores: 1,
    ecommerce_enabled: 0,
    ecommerce_slug: '',
    ecommerce_tagline: '',
    created_at: now,
    synced: 0,
  };

  const owner: LocalUser = {
    id: ownerId,
    store_id: storeId,
    name: ownerName,
    role: 'owner',
    pin_hash: hashPin(ownerPin),
    is_active: 1,
    phone: ownerPhone,
    assigned_location_id: null,
    can_wholesale: 1,
    can_sell_from_warehouse: 1,
    can_manage_ecommerce: 1,
    created_at: now,
    synced: 0,
  };

  await db.stores.add(store);
  await db.users.add(owner);
  await setCurrentStoreId(storeId);

  return { store, owner };
}

/**
 * Pull admin-managed store limits from cloud into local IndexedDB.
 * Prefers canonical `store_quotas`, then falls back to `stores` columns.
 */
export async function pullAdminStoreLimits(storeId: string): Promise<LocalStore | null> {
  const local = await db.stores.get(storeId);
  if (!local) return null;
  if (!isSupabaseConfigured()) return local;

  try {
    const { loadStoreQuota } = await import('./storeQuotas');
    const quota = await loadStoreQuota(storeId);

    const { data, error } = await supabase
      .from('stores')
      .select(
        'warehouse_enabled, max_shops, max_warehouses, max_stores, ecommerce_enabled, ecommerce_slug, ecommerce_tagline, subscription_started_at, subscription_expires_at, subscription_months_granted'
      )
      .eq('id', storeId)
      .maybeSingle();

    if (error && !quota) return local;

    const fromStore = data
      ? {
          warehouse_enabled: data.warehouse_enabled ? 1 : 0,
          max_shops: Math.max(1, Number(data.max_shops) || 1),
          max_warehouses: Math.max(0, Number(data.max_warehouses) || 0),
          max_stores: Math.max(1, Number(data.max_stores) || 1),
        }
      : {
          warehouse_enabled: local.warehouse_enabled ?? 0,
          max_shops: local.max_shops ?? 1,
          max_warehouses: local.max_warehouses ?? 0,
          max_stores: local.max_stores ?? 1,
        };

    const limits = quota
      ? {
          warehouse_enabled: quota.warehouse_enabled ? 1 : 0,
          max_shops: quota.max_shops,
          max_warehouses: quota.max_warehouses,
          max_stores: quota.max_stores,
        }
      : fromStore;

    const updated: LocalStore = {
      ...local,
      ...limits,
      ecommerce_enabled: data?.ecommerce_enabled ? 1 : local.ecommerce_enabled ?? 0,
      ecommerce_slug: String(data?.ecommerce_slug || local.ecommerce_slug || ''),
      ecommerce_tagline: String(data?.ecommerce_tagline || local.ecommerce_tagline || ''),
      subscription_started_at: data?.subscription_started_at
        ? String(data.subscription_started_at)
        : local.subscription_started_at ?? null,
      subscription_expires_at: data?.subscription_expires_at
        ? String(data.subscription_expires_at)
        : local.subscription_expires_at ?? null,
      subscription_months_granted:
        Number(data?.subscription_months_granted) || local.subscription_months_granted || 0,
    };
    await db.stores.put(updated);
    return updated;
  } catch {
    return local;
  }
}

/**
 * How many business stores this owner may create, based on admin max_stores
 * across stores they already own (matched by owner phone when available).
 */
export async function getAdditionalStoreQuota(ownerPhone?: string): Promise<{
  ownedCount: number;
  maxStores: number;
  canCreate: boolean;
}> {
  const { normalizeGhanaPhone } = await import('./platformSettings');
  const phone = ownerPhone ? normalizeGhanaPhone(ownerPhone) : '';
  const localStores = await listLocalStores();
  const currentStoreId = await getCurrentStoreId();
  const ownedStoreIds = new Set<string>();

  if (currentStoreId) {
    ownedStoreIds.add(currentStoreId);
    await pullAdminStoreLimits(currentStoreId);
  }

  if (phone) {
    const localOwners = await db.users
      .filter((u) => u.role === 'owner' && u.is_active === 1)
      .toArray();
    for (const owner of localOwners) {
      const ownerPhoneNorm = owner.phone ? normalizeGhanaPhone(owner.phone) : '';
      if (ownerPhoneNorm && ownerPhoneNorm === phone) {
        ownedStoreIds.add(owner.store_id);
      }
    }

    // Local stores whose support number matches (older accounts)
    for (const store of localStores) {
      const support = store.support_number ? normalizeGhanaPhone(store.support_number) : '';
      if (support && support === phone) {
        ownedStoreIds.add(store.id);
      }
    }

    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('users')
          .select('store_id, phone')
          .eq('role', 'owner')
          .eq('is_active', true);
        for (const row of data || []) {
          const rowPhone = row.phone ? normalizeGhanaPhone(String(row.phone)) : '';
          if (rowPhone && rowPhone === phone && row.store_id) {
            ownedStoreIds.add(String(row.store_id));
          }
        }
      } catch {
        // Offline / schema — fall back to local count
      }
    }
  } else {
    // No phone identity — count stores already on this device
    for (const store of localStores) {
      ownedStoreIds.add(store.id);
    }
  }

  let maxStores = 1;
  for (const storeId of ownedStoreIds) {
    let local = await db.stores.get(storeId);
    if (local) {
      local = (await pullAdminStoreLimits(storeId)) || local;
      maxStores = Math.max(maxStores, local.max_stores ?? 1);
      continue;
    }
    if (isSupabaseConfigured()) {
      try {
        const { loadStoreQuota } = await import('./storeQuotas');
        const quota = await loadStoreQuota(storeId);
        if (quota) {
          maxStores = Math.max(maxStores, quota.max_stores);
          continue;
        }
        const { data } = await supabase
          .from('stores')
          .select('max_stores')
          .eq('id', storeId)
          .maybeSingle();
        if (data) {
          maxStores = Math.max(maxStores, Math.max(1, Number(data.max_stores) || 1));
        }
      } catch {
        // ignore
      }
    }
  }

  const ownedCount = ownedStoreIds.size;
  return {
    ownedCount,
    maxStores,
    canCreate: ownedCount < maxStores,
  };
}

export async function assertCanCreateAdditionalStore(ownerPhone?: string): Promise<void> {
  const quota = await getAdditionalStoreQuota(ownerPhone);
  if (!quota.canCreate) {
    throw new Error(
      `Store limit reached (${quota.ownedCount}/${quota.maxStores}). Ask your administrator to allow more stores.`
    );
  }
}

// Get active users for a store
export async function getStoreUsers(storeId: string): Promise<LocalUser[]> {
  return db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.is_active === 1)
    .toArray();
}

/** Active + blocked staff for owner management UI */
export async function getAllStoreUsers(storeId: string): Promise<LocalUser[]> {
  return db.users.where('store_id').equals(storeId).toArray();
}

// Get all users for current store (active only — login / staff pickers)
export async function getCurrentStoreUsers(): Promise<LocalUser[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return getStoreUsers(storeId);
}

export async function getCurrentStoreUsersIncludingBlocked(): Promise<LocalUser[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return getAllStoreUsers(storeId);
}

/**
 * Authenticate user by PIN within current store.
 * Blocked cashiers (is_active === 0) may still authenticate; the app
 * routes them to a restricted “contact store owner” screen.
 */
export async function authenticateByPin(pin: string): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  
  const pinHash = hashPin(pin);
  const users = await db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.pin_hash === pinHash)
    .toArray();
  
  return users.length > 0 ? users[0] : null;
}

// Verify owner PIN for current store
export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return false;
  
  const pinHash = hashPin(pin);
  const owners = await db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.role === 'owner' && u.pin_hash === pinHash && u.is_active === 1)
    .toArray();
  
  return owners.length > 0;
}

// Add a user to current store
export async function addUserToStore(
  name: string,
  pin: string,
  role: 'owner' | 'cashier',
  phone = ''
): Promise<LocalUser> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  
  const user: LocalUser = {
    id: generateId(),
    store_id: storeId,
    name,
    role,
    pin_hash: hashPin(pin),
    is_active: 1,
    phone: phone.trim(),
    assigned_location_id: null,
    can_wholesale: role === 'owner' ? 1 : 0,
    can_sell_from_warehouse: role === 'owner' ? 1 : 0,
    can_manage_ecommerce: role === 'owner' ? 1 : 0,
    created_at: new Date().toISOString(),
    synced: 0,
  };
  
  await db.users.add(user);
  return user;
}

export async function updateUserPin(userId: string, newPin: string): Promise<void> {
  await db.users.update(userId, {
    pin_hash: hashPin(newPin),
    synced: 0,
  });
  if (isSupabaseConfigured()) {
    await supabase.from('users').update({ pin_hash: hashPin(newPin) }).eq('id', userId);
  }
}

/** Attach / update a user's Ghana phone (self-serve or owner edit). */
export async function updateUserPhone(userId: string, phoneRaw: string): Promise<string> {
  const { isValidGhanaPhone, normalizeGhanaPhone } = await import('./platformSettings');
  if (!isValidGhanaPhone(phoneRaw)) {
    throw new Error('Enter a valid Ghana mobile number (e.g. 024XXXXXXX).');
  }
  const phone = normalizeGhanaPhone(phoneRaw);
  const display =
    phone.startsWith('233') && phone.length === 12 ? `0${phone.slice(3)}` : phoneRaw.trim();

  const existing = await db.users.get(userId);
  if (!existing) throw new Error('User not found');

  await db.users.put({
    ...existing,
    phone: display,
    synced: 0,
  });

  if (isSupabaseConfigured()) {
    const { error } = await supabase
      .from('users')
      .update({ phone: display })
      .eq('id', userId);
    if (!error) {
      await db.users.update(userId, { synced: 1 });
    }
    // If cloud update fails (offline / missing column), keep local phone with synced:0
  }

  return display;
}

/** Active owner for the current (or given) store — used after warehouse PIN login. */
export async function getActiveStoreOwner(storeId?: string): Promise<LocalUser | null> {
  const id = storeId || (await getCurrentStoreId());
  if (!id) return null;
  const owners = await db.users
    .where('store_id')
    .equals(id)
    .and((u) => u.role === 'owner' && u.is_active === 1)
    .toArray();
  return owners[0] || null;
}

// Block a cashier (can log in, but app shows a restricted contact-owner screen)
export async function deactivateUser(userId: string): Promise<void> {
  await db.users.update(userId, { is_active: 0, synced: 0 });
}

export async function activateUser(userId: string): Promise<void> {
  await db.users.update(userId, { is_active: 1, synced: 0 });
}

// Delete a user
export async function deleteUser(userId: string): Promise<void> {
  await db.users.delete(userId);
}

export async function getCurrentStoreTransactions(): Promise<LocalTransaction[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.transactions.where('store_id').equals(storeId).toArray();
}

export async function getTransactionsForCashier(cashierId: string): Promise<LocalTransaction[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.transactions
    .where('store_id')
    .equals(storeId)
    .and((t) => t.cashier_id === cashierId)
    .toArray();
}

export async function getTransactionItems(transactionId: string): Promise<LocalTransactionItem[]> {
  return db.transaction_items.where('transaction_id').equals(transactionId).toArray();
}

// Get products for current store
export async function getCurrentStoreProducts(): Promise<LocalProduct[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.products.where('store_id').equals(storeId).toArray();
}

/**
 * Hard-delete a product everywhere: local catalog, warehouse batches/movements,
 * cloud product row (CASCADE clears related stock), and a tombstone so sync
 * cannot resurrect it. Historical sales/order lines keep product_name.
 */
export async function deleteProductCompletely(productId: string): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) return;

  const storeId = product.store_id;
  const tombstoneId = `products:${productId}`;

  await db.transaction(
    'rw',
    [
      db.products,
      db.stock_batches,
      db.stock_movements,
      db.online_order_items,
      db.deleted_records,
    ],
    async () => {
      const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
      await Promise.all(batches.map((b) => db.stock_batches.delete(b.id)));

      const movements = await db.stock_movements.where('product_id').equals(productId).toArray();
      await Promise.all(movements.map((m) => db.stock_movements.delete(m.id)));

      const orderItems = await db.online_order_items
        .where('product_id')
        .equals(productId)
        .toArray();
      await Promise.all(
        orderItems.map((item) =>
          db.online_order_items.update(item.id, { product_id: null, synced: 0 })
        )
      );

      await db.products.delete(productId);

      await db.deleted_records.put({
        id: tombstoneId,
        store_id: storeId,
        table_name: 'products',
        record_id: productId,
        deleted_at: new Date().toISOString(),
        synced: 0,
      });
    }
  );

  if (isSupabaseConfigured()) {
    try {
      // Cloud CASCADE removes stock_batches / stock_movements; txn items SET NULL
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (!error) {
        await db.deleted_records.update(tombstoneId, { synced: 1 });
      }
    } catch {
      // Offline / network — tombstone synced=0 will push on next sync
    }
  }
}

async function getDeletedProductIds(storeId: string): Promise<Set<string>> {
  const rows = await db.deleted_records
    .where('store_id')
    .equals(storeId)
    .and((r) => r.table_name === 'products')
    .toArray();
  return new Set(rows.map((r) => r.record_id));
}

// Get active products for current store
export async function getCurrentStoreActiveProducts(): Promise<LocalProduct[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.products
    .where('store_id')
    .equals(storeId)
    .and(p => p.is_active === 1)
    .toArray();
}

// Add product to current store
export async function addProductToStore(product: Omit<LocalProduct, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'>): Promise<LocalProduct> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  
  const now = new Date().toISOString();
  const newProduct: LocalProduct = {
    id: generateId(),
    store_id: storeId,
    pack_size: 1,
    track_expiry: 0,
    wholesale_mode: 'none',
    wholesale_pack_price: 0,
    wholesale_unit_price: 0,
    wholesale_tiers_json: '[]',
    ...product,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  
  await db.products.add(newProduct);
  return newProduct;
}

// Get product by barcode in current store
export async function getProductByBarcode(barcode: string): Promise<LocalProduct | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  
  const products = await db.products
    .where('store_id')
    .equals(storeId)
    .and(p => p.barcode === barcode && p.is_active === 1)
    .toArray();
  
  return products.length > 0 ? products[0] : null;
}

export async function getCurrentStoreExpenses(): Promise<LocalExpense[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.expenses.where('store_id').equals(storeId).toArray();
}

export async function addExpense(
  expense: Omit<LocalExpense, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'>
): Promise<LocalExpense> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const now = new Date().toISOString();
  const amount = toMoneyAmount(expense.amount);
  if (amount <= 0) throw new Error('Expense amount must be greater than zero');

  const newExpense: LocalExpense = {
    id: generateId(),
    store_id: storeId,
    ...expense,
    amount,
    created_at: now,
    updated_at: now,
    synced: 0,
  };

  await db.expenses.add(newExpense);
  return newExpense;
}

export async function updateExpense(
  id: string,
  updates: Partial<Pick<LocalExpense, 'description' | 'category' | 'amount' | 'notes'>>
): Promise<void> {
  const next = { ...updates };
  if (updates.amount !== undefined) {
    next.amount = toMoneyAmount(updates.amount);
    if ((next.amount ?? 0) <= 0) throw new Error('Expense amount must be greater than zero');
  }
  await db.expenses.update(id, {
    ...next,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id);
}

export async function getCurrentStoreCashBookEntries(): Promise<LocalCashBookEntry[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.cash_book_entries.where('store_id').equals(storeId).toArray();
}

export async function addCashBookEntry(
  entry: Omit<
    LocalCashBookEntry,
    'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'
  >
): Promise<LocalCashBookEntry> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const now = new Date().toISOString();
  const entryDate = (entry.entry_date || now.slice(0, 10)).slice(0, 10);
  const amount = toMoneyAmount(entry.amount);
  if (amount <= 0) throw new Error('Cash book amount must be greater than zero');

  const newEntry: LocalCashBookEntry = {
    id: generateId(),
    store_id: storeId,
    ...entry,
    amount,
    entry_date: entryDate,
    created_at: now,
    updated_at: now,
    synced: 0,
  };

  await db.cash_book_entries.add(newEntry);
  return newEntry;
}

export async function deleteCashBookEntry(id: string): Promise<void> {
  await db.cash_book_entries.delete(id);
}

export async function importProductsFromRows(
  rows: Array<{
    name: string;
    category: string;
    barcode: string;
    cost_price: number;
    selling_price: number;
    stock_level: number;
    sku_type?: string;
  }>
): Promise<{ imported: number; skipped: number }> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const { setProductStockLevel } = await import('./warehouse');
  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!row.name.trim()) {
      skipped++;
      continue;
    }

    if (row.barcode) {
      const existing = await db.products
        .where('store_id')
        .equals(storeId)
        .and(p => p.barcode === row.barcode)
        .first();
      if (existing) {
        skipped++;
        continue;
      }
    }

    const productId = generateId();
    await db.products.add({
      id: productId,
      store_id: storeId,
      name: row.name.trim(),
      category: row.category.trim() || 'Other',
      sku_type: row.sku_type?.trim() || 'unit',
      barcode: row.barcode.trim(),
      cost_price: toMoneyAmount(row.cost_price),
      selling_price: toMoneyAmount(row.selling_price),
      stock_level: 0,
      is_active: 1,
      image_url: '',
      pack_size: 1,
      track_expiry: 0,
      wholesale_mode: 'none',
      wholesale_pack_price: 0,
      wholesale_unit_price: 0,
      wholesale_tiers_json: '[]',
      created_at: now,
      updated_at: now,
      synced: 0,
    });
    const openingQty = Math.max(0, Math.floor(Number(row.stock_level) || 0));
    if (openingQty > 0) {
      await setProductStockLevel({
        storeId,
        productId,
        targetQty: openingQty,
        note: 'CSV import opening stock',
      });
    }
    imported++;
  }

  return { imported, skipped };
}

function formatSyncError(label: string, error: unknown): string {
  const message = formatUnknownError(error);
  if (message.includes('Load failed') || message.includes('Failed to fetch')) {
    return `${label}: Could not reach Supabase. Check your internet connection and VITE_SUPABASE_URL.`;
  }
  return `${label}: ${message}`;
}

function asQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const floored = Math.floor(n);
  return floored > 50_000_000 ? 0 : floored;
}

/** PostgREST defaults to 1000 rows — page so phone and laptop pull the same full ledger. */
async function fetchAllStoreRows(
  table: string,
  storeId: string
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const pageSize = 1000;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('store_id', storeId)
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = (data || []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from >= 50_000) break;
  }
  return { data: all, error: null };
}

function mapCloudBatch(row: Record<string, unknown>): LocalStockBatch {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    product_id: String(row.product_id),
    location_id: String(row.location_id),
    batch_code: String(row.batch_code || ''),
    expiry_date: (row.expiry_date as string) || null,
    quantity: asQty(row.quantity),
    cost_price: Number(row.cost_price) || 0,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || row.created_at || ''),
    synced: 1,
  };
}

function mapCloudLocation(row: Record<string, unknown>): LocalLocation {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: String(row.name || ''),
    location_type: row.location_type === 'warehouse' ? 'warehouse' : 'shop',
    is_default: row.is_default ? 1 : 0,
    is_active: row.is_active === false ? 0 : 1,
    access_pin_hash: (row.access_pin_hash as string) || null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || row.created_at || ''),
    synced: 1,
  };
}

/**
 * Replace this store's local stock ledger with the cloud snapshot so every
 * phone and computer shows the same figures. Keeps only unsynced local
 * deductions (sales not pushed yet) and unsynced non-OPENING receives.
 */
export async function adoptCloudStockLedger(
  storeId: string
): Promise<{ ok: boolean; batchCount: number; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, batchCount: 0, error: 'Supabase not configured' };
  }

  const { data: remoteRows, error } = await fetchAllStoreRows('stock_batches', storeId);
  if (error || !remoteRows) {
    return { ok: false, batchCount: 0, error: formatUnknownError(error) || 'Could not pull stock from cloud' };
  }

  const { data: remoteLocs, error: locError } = await fetchAllStoreRows('locations', storeId);
  if (locError || !remoteLocs) {
    return { ok: false, batchCount: 0, error: formatUnknownError(locError) || 'Could not pull locations from cloud' };
  }

  const localBatches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const localById = new Map(localBatches.map((b) => [b.id, b]));
  const remoteBatches = remoteRows.map(mapCloudBatch);
  const remoteIds = new Set(remoteBatches.map((b) => b.id));

  const nextBatches: LocalStockBatch[] = remoteBatches.map((remote) => {
    const local = localById.get(remote.id);
    if (local && local.synced === 0 && asQty(local.quantity) < asQty(remote.quantity)) {
      return {
        ...remote,
        quantity: asQty(local.quantity),
        updated_at: local.updated_at || remote.updated_at,
        synced: 0,
      };
    }
    return remote;
  });

  for (const local of localBatches) {
    if (remoteIds.has(local.id)) continue;
    if (local.synced !== 0) continue;
    if ((local.batch_code || '').trim().toUpperCase() === 'OPENING') continue;
    if (!isUuid(local.id) || !isUuid(local.product_id) || !isUuid(local.location_id)) continue;
    nextBatches.push({ ...local, quantity: asQty(local.quantity) });
  }

  const remoteLocations = remoteLocs.map(mapCloudLocation);
  const remoteLocIds = new Set(remoteLocations.map((l) => l.id));
  const localLocations = await db.locations.where('store_id').equals(storeId).toArray();

  await db.transaction('rw', db.stock_batches, db.locations, async () => {
    await db.stock_batches.where('store_id').equals(storeId).delete();
    if (nextBatches.length > 0) {
      await db.stock_batches.bulkPut(nextBatches);
    }
    for (const loc of localLocations) {
      if (remoteLocIds.has(loc.id)) continue;
      const keepNew =
        loc.synced === 0 && isUuid(loc.id) && loc.location_type === 'warehouse';
      if (!keepNew) {
        await db.locations.delete(loc.id);
      }
    }
    if (remoteLocations.length > 0) {
      await db.locations.bulkPut(remoteLocations);
    }
  });

  return { ok: true, batchCount: nextBatches.length };
}

let hydrateInFlight: Promise<{ ok: boolean; message: string }> | null = null;
/** Last successful cloud stock adopt (ms). Used to skip duplicate pulls. */
export let lastStockHydrateOkAt = 0;

export async function refreshStockFromCloud(): Promise<{ ok: boolean; message: string }> {
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return { ok: false, message: 'No store selected' };

    if (!isSupabaseConfigured()) {
      return { ok: false, message: 'Supabase not configured' };
    }

    const adopted = await adoptCloudStockLedger(storeId);
    if (!adopted.ok) {
      return { ok: false, message: adopted.error || 'Cloud stock pull failed' };
    }

    try {
      const { canonicalizeStoreStock, syncStoreCatalogStockFromBatches } = await import('@/lib/warehouse');
      await canonicalizeStoreStock(storeId);
      await syncStoreCatalogStockFromBatches(storeId);
    } catch {
      // Ledger was replaced even if heal fails
    }

    lastStockHydrateOkAt = Date.now();
    return { ok: true, message: `Stock matched to cloud (${adopted.batchCount} batches)` };
  })();

  try {
    return await hydrateInFlight;
  } finally {
    hydrateInFlight = null;
  }
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

async function upsertToSupabase<T extends Record<string, unknown>>(
  label: string,
  table:
    | 'stores'
    | 'users'
    | 'products'
    | 'transactions'
    | 'transaction_items'
    | 'expenses'
    | 'cash_book_entries'
    | 'locations'
    | 'stock_batches'
    | 'stock_movements'
    | 'online_orders'
    | 'online_order_items',
  rows: T[],
  markSynced: () => Promise<void>,
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0;

  try {
    // Append-only ledgers have INSERT policies but historically no UPDATE.
    // PostgREST upsert is ON CONFLICT DO UPDATE and needs UPDATE RLS (42501).
    const appendOnly = table === 'stock_movements' || table === 'transaction_items';
    const { error } = await supabase.from(table).upsert(rows as Record<string, unknown>[], {
      onConflict: 'id',
      ignoreDuplicates: appendOnly,
    });
    if (error) {
      errors.push(formatSyncError(label, error));
      return 0;
    }

    await markSynced();
    return rows.length;
  } catch (error) {
    errors.push(formatSyncError(label, error));
    return 0;
  }
}

// Sync to Supabase
export async function syncToSupabase(opts?: { skipPing?: boolean }): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured. Add environment variables to enable cloud sync.' };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected' };
  }

  if (!opts?.skipPing) {
    const connection = await testSupabaseConnection();
    if (!connection.ok) {
      return { success: false, message: connection.error || 'Could not connect to Supabase.' };
    }
  }

  const errors: string[] = [];
  let syncedCount = 0;

  try {
    try {
      const { canonicalizeStoreStock } = await import('@/lib/warehouse');
      await canonicalizeStoreStock(storeId);
    } catch {
      // Push remaining UUID-safe rows even if heal fails
    }

    // Push hard-deletes first so cloud rows (and CASCADE children) are removed
    const pendingDeletes = await db.deleted_records
      .where('store_id')
      .equals(storeId)
      .and((r) => r.synced === 0)
      .toArray();

    for (const del of pendingDeletes) {
      if (del.table_name !== 'products') continue;
      try {
        const { error } = await supabase.from('products').delete().eq('id', del.record_id);
        if (error) {
          errors.push(formatSyncError('Product delete', error));
        } else {
          await db.deleted_records.update(del.id, { synced: 1 });
          syncedCount += 1;
        }
      } catch (error) {
        errors.push(formatSyncError('Product delete', error));
      }
    }

    const store = await db.stores.get(storeId);
    if (store && store.synced === 0) {
      // Do NOT push admin-managed fields — local defaults would overwrite raised limits.
      syncedCount += await upsertToSupabase(
        'Store',
        'stores',
        [{
          id: store.id,
          name: store.name,
          address: store.address,
          support_number: store.support_number,
          discount_cap_percentage: store.discount_cap_percentage,
          pin_on_discount_enabled: store.pin_on_discount_enabled === 1,
          discount_allow_percentage: (store.discount_allow_percentage ?? 1) === 1,
          discount_allow_fixed: (store.discount_allow_fixed ?? 1) === 1,
          cashier_can_discount: (store.cashier_can_discount ?? 1) === 1,
          momo_account_name: store.momo_account_name || '',
          momo_number: store.momo_number || '',
          momo_network: store.momo_network || '',
          logo_url: store.logo_url || '',
          created_at: store.created_at,
        }],
        async () => { await db.stores.update(storeId, { synced: 1 }); },
        errors
      );
    }

    const unsyncedUsers = await db.users.where('store_id').equals(storeId).and(u => u.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Users',
      'users',
      unsyncedUsers.map(u => ({
        id: u.id,
        store_id: u.store_id,
        name: u.name,
        role: u.role,
        pin_hash: u.pin_hash,
        is_active: u.is_active === 1,
        phone: u.phone || '',
        assigned_location_id: uuidOrNull(u.assigned_location_id),
        can_wholesale: (u.can_wholesale ?? 0) === 1,
        can_sell_from_warehouse: (u.can_sell_from_warehouse ?? 0) === 1,
        can_manage_ecommerce: (u.can_manage_ecommerce ?? (u.role === 'owner' ? 1 : 0)) === 1,
        created_at: u.created_at,
      })),
      async () => { await Promise.all(unsyncedUsers.map(u => db.users.update(u.id, { synced: 1 }))); },
      errors
    );

    const unsyncedLocations = await db.locations.where('store_id').equals(storeId).and(l => l.synced === 0).toArray();
    const locationsToPush = unsyncedLocations.filter((l) => isUuid(l.id) && isUuid(l.store_id));
    for (const leftover of unsyncedLocations) {
      if (isUuid(leftover.id) && isUuid(leftover.store_id)) continue;
      await db.locations.delete(leftover.id);
    }
    syncedCount += await upsertToSupabase(
      'Locations',
      'locations',
      locationsToPush.map(l => ({
        id: l.id,
        store_id: l.store_id,
        name: l.name,
        location_type: l.location_type,
        is_default: l.is_default === 1,
        is_active: l.is_active === 1,
        access_pin_hash: l.access_pin_hash || null,
        created_at: l.created_at,
        updated_at: l.updated_at,
      })),
      async () => { await Promise.all(locationsToPush.map(l => db.locations.update(l.id, { synced: 1 }))); },
      errors
    );

    // Push batches BEFORE products so catalog stock_level never arrives without matching batches
    const unsyncedBatches = await db.stock_batches.where('store_id').equals(storeId).and(b => b.synced === 0).toArray();
    const batchesToPush: LocalStockBatch[] = [];
    const openingUnsynced = unsyncedBatches.filter(
      (b) => (b.batch_code || '').trim().toUpperCase() === 'OPENING'
    );
    const remoteOpeningQty = new Map<string, { quantity: number; updated_at: string }>();
    if (openingUnsynced.length > 0) {
      const { data: remoteOpenings } = await fetchAllStoreRows('stock_batches', storeId);
      for (const row of remoteOpenings || []) {
        if (String(row.batch_code || '').trim().toUpperCase() !== 'OPENING') continue;
        remoteOpeningQty.set(String(row.id), {
          quantity: asQty(row.quantity),
          updated_at: String(row.updated_at || row.created_at || ''),
        });
      }
    }
    for (const batch of unsyncedBatches) {
      const localQty = asQty(batch.quantity);
      if ((batch.batch_code || '').trim().toUpperCase() === 'OPENING') {
        const remote = remoteOpeningQty.get(batch.id);
        if (remote && remote.quantity < localQty) {
          // Cloud already has a deducted qty — do not resurrect stock from a stale device OPENING
          await db.stock_batches.update(batch.id, {
            quantity: remote.quantity,
            updated_at: remote.updated_at || batch.updated_at,
            synced: 1,
          });
          continue;
        }
      }
      if (!isUuid(batch.id) || !isUuid(batch.store_id) || !isUuid(batch.product_id) || !isUuid(batch.location_id)) {
        await db.stock_batches.delete(batch.id);
        continue;
      }
      batchesToPush.push({ ...batch, quantity: localQty });
    }
    syncedCount += await upsertToSupabase(
      'Stock batches',
      'stock_batches',
      batchesToPush.map(b => ({
        id: b.id,
        store_id: b.store_id,
        product_id: b.product_id,
        location_id: b.location_id,
        batch_code: b.batch_code || '',
        expiry_date: dateOrNull(b.expiry_date),
        quantity: b.quantity,
        cost_price: b.cost_price,
        created_at: b.created_at,
        updated_at: b.updated_at,
      })),
      async () => { await Promise.all(batchesToPush.map(b => db.stock_batches.update(b.id, { synced: 1 }))); },
      errors
    );

    const unsyncedMovements = await db.stock_movements.where('store_id').equals(storeId).and(m => m.synced === 0).toArray();
    const movementsToPush: LocalStockMovement[] = [];
    for (const movement of unsyncedMovements) {
      if (!isUuid(movement.id) || !isUuid(movement.store_id) || !isUuid(movement.product_id)) {
        await db.stock_movements.delete(movement.id);
        continue;
      }
      movementsToPush.push(movement);
    }
    syncedCount += await upsertToSupabase(
      'Stock movements',
      'stock_movements',
      movementsToPush.map(m => ({
        id: m.id,
        store_id: m.store_id,
        product_id: m.product_id,
        batch_id: uuidOrNull(m.batch_id),
        from_location_id: uuidOrNull(m.from_location_id),
        to_location_id: uuidOrNull(m.to_location_id),
        movement_type: m.movement_type,
        quantity: m.quantity,
        note: m.note || '',
        user_id: uuidOrNull(m.user_id),
        created_at: m.created_at,
      })),
      async () => { await Promise.all(movementsToPush.map(m => db.stock_movements.update(m.id, { synced: 1 }))); },
      errors
    );

    const unsyncedProducts = await db.products.where('store_id').equals(storeId).and(p => p.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Products',
      'products',
      unsyncedProducts.map(p => ({
        id: p.id,
        store_id: p.store_id,
        name: p.name,
        category: p.category,
        sku_type: p.sku_type,
        barcode: p.barcode,
        cost_price: p.cost_price,
        selling_price: p.selling_price,
        stock_level: p.stock_level,
        is_active: p.is_active === 1,
        image_url: p.image_url || '',
        pack_size: p.pack_size ?? 1,
        track_expiry: (p.track_expiry ?? 0) === 1,
        wholesale_mode: p.wholesale_mode || 'none',
        wholesale_pack_price: p.wholesale_pack_price ?? 0,
        wholesale_unit_price: p.wholesale_unit_price ?? 0,
        wholesale_tiers_json: p.wholesale_tiers_json || '[]',
        sell_online: (p.sell_online ?? 0) === 1,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
      async () => { await Promise.all(unsyncedProducts.map(p => db.products.update(p.id, { synced: 1 }))); },
      errors
    );

    const unsyncedTxns = await db.transactions.where('store_id').equals(storeId).and(t => t.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Transactions',
      'transactions',
      unsyncedTxns.map(t => ({
        id: t.id,
        store_id: t.store_id,
        receipt_number: t.receipt_number,
        cashier_id: uuidOrNull(t.cashier_id),
        cashier_name: t.cashier_name,
        total_amount: t.total_amount,
        discount_applied: t.discount_applied,
        payment_method: t.payment_method,
        cash_amount: t.cash_amount,
        paystack_amount: t.paystack_amount,
        paystack_reference: t.paystack_reference,
        status: t.status,
        location_id: uuidOrNull(t.location_id),
        sale_mode: t.sale_mode || 'retail',
        created_at: t.created_at,
      })),
      async () => { await Promise.all(unsyncedTxns.map(t => db.transactions.update(t.id, { synced: 1 }))); },
      errors
    );

    const unsyncedItems = await db.transaction_items.where('store_id').equals(storeId).and(i => i.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Transaction items',
      'transaction_items',
      unsyncedItems.map(i => ({
        id: i.id,
        store_id: i.store_id,
        transaction_id: i.transaction_id,
        product_id: uuidOrNull(i.product_id),
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
        unit_type: i.unit_type || 'base',
        pack_size: i.pack_size ?? 1,
        base_quantity: i.base_quantity ?? i.quantity,
        batch_id: uuidOrNull(i.batch_id),
      })),
      async () => { await Promise.all(unsyncedItems.map(i => db.transaction_items.update(i.id, { synced: 1 }))); },
      errors
    );

    const unsyncedExpenses = await db.expenses.where('store_id').equals(storeId).and(e => e.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Expenses',
      'expenses',
      unsyncedExpenses.map(e => ({
        id: e.id,
        store_id: e.store_id,
        description: e.description,
        category: e.category,
        amount: e.amount,
        notes: e.notes,
        created_at: e.created_at,
        updated_at: e.updated_at,
      })),
      async () => { await Promise.all(unsyncedExpenses.map(e => db.expenses.update(e.id, { synced: 1 }))); },
      errors
    );

    const unsyncedCashBook = await db.cash_book_entries
      .where('store_id')
      .equals(storeId)
      .and((e) => e.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Cash book',
      'cash_book_entries',
      unsyncedCashBook.map((e) => ({
        id: e.id,
        store_id: e.store_id,
        entry_type: e.entry_type,
        description: e.description,
        category: e.category,
        amount: e.amount,
        notes: e.notes,
        entry_date: e.entry_date,
        created_by: e.created_by || '',
        created_at: e.created_at,
        updated_at: e.updated_at,
      })),
      async () => {
        await Promise.all(unsyncedCashBook.map((e) => db.cash_book_entries.update(e.id, { synced: 1 })));
      },
      errors
    );

    const unsyncedOrders = await db.online_orders.where('store_id').equals(storeId).and(o => o.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Online orders',
      'online_orders',
      unsyncedOrders.map(o => ({
        id: o.id,
        store_id: o.store_id,
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        customer_address: o.customer_address,
        notes: o.notes,
        status: o.status,
        payment_method: o.payment_method,
        total_amount: o.total_amount,
        created_at: o.created_at,
        updated_at: o.updated_at,
      })),
      async () => { await Promise.all(unsyncedOrders.map(o => db.online_orders.update(o.id, { synced: 1 }))); },
      errors
    );

    const unsyncedOrderItems = await db.online_order_items.where('store_id').equals(storeId).and(i => i.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Online order items',
      'online_order_items',
      unsyncedOrderItems.map(i => ({
        id: i.id,
        store_id: i.store_id,
        order_id: i.order_id,
        product_id: uuidOrNull(i.product_id),
        product_name: i.product_name,
        unit_price: i.unit_price,
        quantity: i.quantity,
        subtotal: i.subtotal,
        created_at: i.created_at,
      })),
      async () => { await Promise.all(unsyncedOrderItems.map(i => db.online_order_items.update(i.id, { synced: 1 }))); },
      errors
    );

    if (errors.length > 0) {
      return { success: false, message: `Partial sync. Errors: ${errors.join('; ')}` };
    }

    await db.sync_meta.put({
      id: 'last_sync',
      last_synced_at: new Date().toISOString(),
    });

    if (syncedCount === 0) {
      return { success: true, message: 'Everything is already synced!' };
    }

    return { success: true, message: `Synced ${syncedCount} records at ${new Date().toLocaleTimeString()}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Load failed') || msg.includes('Failed to fetch')) {
      return {
        success: false,
        message: 'Sync failed: Could not reach Supabase. Check your internet connection, VITE_SUPABASE_URL, and that your Supabase project is active.',
      };
    }
    return { success: false, message: `Sync failed: ${msg}` };
  }
}

export async function syncFromSupabase(opts?: {
  onlyTables?: string[];
  skipCatalogAlign?: boolean;
  includeHistory?: boolean;
}): Promise<{ success: boolean; message: string; pulledCount: number }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.', pulledCount: 0 };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected', pulledCount: 0 };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.', pulledCount: 0 };
  }

  let pulledCount = 0;
  const errors: string[] = [];
  const deletedProductIds = await getDeletedProductIds(storeId);

  try {
    if (!opts?.onlyTables) {
    const { data: remoteStore, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .maybeSingle();

    if (storeError) errors.push(formatSyncError('Store', storeError));
    else if (remoteStore) {
      const localStore = await db.stores.get(storeId);
      const { loadStoreQuota } = await import('./storeQuotas');
      const quota = await loadStoreQuota(storeId);
      await db.stores.put({
        id: storeId,
        name: remoteStore.name,
        address: remoteStore.address || '',
        support_number: remoteStore.support_number || '',
        discount_cap_percentage: remoteStore.discount_cap_percentage ?? 10,
        pin_on_discount_enabled: remoteStore.pin_on_discount_enabled ? 1 : 0,
        discount_allow_percentage: remoteStore.discount_allow_percentage === false ? 0 : 1,
        discount_allow_fixed: remoteStore.discount_allow_fixed === false ? 0 : 1,
        cashier_can_discount: remoteStore.cashier_can_discount === false ? 0 : 1,
        momo_account_name: remoteStore.momo_account_name || '',
        momo_number: remoteStore.momo_number || '',
        momo_network: remoteStore.momo_network || '',
        subscription_started_at: remoteStore.subscription_started_at
          ? String(remoteStore.subscription_started_at)
          : null,
        subscription_expires_at: remoteStore.subscription_expires_at
          ? String(remoteStore.subscription_expires_at)
          : null,
        subscription_months_granted: Number(remoteStore.subscription_months_granted) || 0,
        logo_url: remoteStore.logo_url || localStore?.logo_url || '',
        warehouse_enabled: quota
          ? quota.warehouse_enabled
            ? 1
            : 0
          : remoteStore.warehouse_enabled
            ? 1
            : 0,
        max_shops: quota?.max_shops ?? (Number(remoteStore.max_shops) || 1),
        max_warehouses: quota?.max_warehouses ?? (Number(remoteStore.max_warehouses) || 0),
        max_stores: quota?.max_stores ?? Math.max(1, Number(remoteStore.max_stores) || 1),
        ecommerce_enabled: remoteStore.ecommerce_enabled ? 1 : 0,
        ecommerce_slug: remoteStore.ecommerce_slug || localStore?.ecommerce_slug || '',
        ecommerce_tagline: remoteStore.ecommerce_tagline || localStore?.ecommerce_tagline || '',
        created_at: remoteStore.created_at,
        synced: localStore?.synced === 0 ? 0 : 1,
      });
      pulledCount++;
    }
    }

    const tables = [
      {
        label: 'Users',
        table: 'users',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          name: row.name as string,
          role: row.role as 'owner' | 'cashier',
          pin_hash: row.pin_hash as string,
          is_active: row.is_active ? 1 : 0,
          phone: String(row.phone || ''),
          assigned_location_id: (row.assigned_location_id as string) || null,
          can_wholesale: row.can_wholesale ? 1 : 0,
          can_sell_from_warehouse: row.can_sell_from_warehouse ? 1 : 0,
          can_manage_ecommerce: (row.can_manage_ecommerce || row.role === 'owner') ? 1 : 0,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.users,
        merge: async (remote: LocalUser, local: LocalUser | undefined) => {
          if (!local) return remote;
          // Keep unsynced local edits (e.g. self-serve phone) until push succeeds
          if (local.synced === 0) {
            return {
              ...remote,
              name: local.name || remote.name,
              pin_hash: local.pin_hash || remote.pin_hash,
              is_active: local.is_active,
              phone: (local.phone || '').trim() || remote.phone || '',
              assigned_location_id:
                local.assigned_location_id !== undefined
                  ? local.assigned_location_id
                  : remote.assigned_location_id,
              can_wholesale: local.can_wholesale ?? remote.can_wholesale,
              can_sell_from_warehouse:
                local.can_sell_from_warehouse ?? remote.can_sell_from_warehouse,
              can_manage_ecommerce: local.can_manage_ecommerce ?? remote.can_manage_ecommerce,
              synced: 0,
            };
          }
          // Never clobber a local phone with an empty cloud value
          return {
            ...remote,
            phone: (remote.phone || '').trim() || local.phone || '',
          };
        },
      },
      {
        label: 'Products',
        table: 'products',
        map: (row: Record<string, unknown>) => {
          const local = row;
          return {
            id: local.id as string,
            store_id: local.store_id as string,
            name: local.name as string,
            category: (local.category as string) || 'Other',
            sku_type: (local.sku_type as string) || 'unit',
            barcode: (local.barcode as string) || '',
            cost_price: Number(local.cost_price) || 0,
            selling_price: Number(local.selling_price) || 0,
            stock_level: Number(local.stock_level) || 0,
            is_active: local.is_active ? 1 : 0,
            image_url: (local.image_url as string) || '',
            pack_size: Number(local.pack_size) || 1,
            track_expiry: local.track_expiry ? 1 : 0,
            wholesale_mode: (local.wholesale_mode as string) || 'none',
            wholesale_pack_price: Number(local.wholesale_pack_price) || 0,
            wholesale_unit_price: Number(local.wholesale_unit_price) || 0,
            wholesale_tiers_json: (local.wholesale_tiers_json as string) || '[]',
            sell_online: local.sell_online ? 1 : 0,
            created_at: local.created_at as string,
            updated_at: (local.updated_at as string) || (local.created_at as string),
            synced: 1,
          };
        },
        dbTable: db.products,
        merge: async (remote: LocalProduct, local: LocalProduct | undefined) => {
          if (!local) return remote;
          if (local.synced !== 0) return remote;
          // Keep unsynced name/price edits, but stock always follows cloud then batch align
          return {
            ...local,
            stock_level: asQty(remote.stock_level),
          };
        },
      },
      {
        label: 'Transactions',
        table: 'transactions',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          receipt_number: row.receipt_number as string,
          cashier_id: (row.cashier_id as string) || '',
          cashier_name: (row.cashier_name as string) || '',
          total_amount: Number(row.total_amount) || 0,
          discount_applied: Number(row.discount_applied) || 0,
          payment_method: row.payment_method as 'cash' | 'split' | 'paystack',
          cash_amount: Number(row.cash_amount) || 0,
          paystack_amount: Number(row.paystack_amount) || 0,
          paystack_reference: (row.paystack_reference as string) || '',
          status: row.status as 'completed' | 'pending',
          location_id: (row.location_id as string) || undefined,
          sale_mode: ((row.sale_mode as 'retail' | 'wholesale') || 'retail'),
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.transactions,
      },
      {
        label: 'Transaction items',
        table: 'transaction_items',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          transaction_id: row.transaction_id as string,
          product_id: (row.product_id as string) || '',
          product_name: (row.product_name as string) || '',
          quantity: Number(row.quantity) || 0,
          unit_price: Number(row.unit_price) || 0,
          subtotal: Number(row.subtotal) || 0,
          unit_type: (row.unit_type as string) || 'base',
          pack_size: Number(row.pack_size) || 1,
          base_quantity: Number(row.base_quantity) || Number(row.quantity) || 0,
          batch_id: (row.batch_id as string) || undefined,
          synced: 1,
        }),
        dbTable: db.transaction_items,
      },
      {
        label: 'Expenses',
        table: 'expenses',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          description: row.description as string,
          category: (row.category as string) || 'Other',
          amount: Number(row.amount) || 0,
          notes: (row.notes as string) || '',
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.expenses,
        merge: async (remote: LocalExpense, local: LocalExpense | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Cash book',
        table: 'cash_book_entries',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          entry_type: row.entry_type === 'income' ? 'income' : 'expense',
          description: (row.description as string) || '',
          category: (row.category as string) || 'Other',
          amount: Number(row.amount) || 0,
          notes: (row.notes as string) || '',
          entry_date: String(row.entry_date || row.created_at || '').slice(0, 10),
          created_by: (row.created_by as string) || '',
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.cash_book_entries,
        merge: async (remote: LocalCashBookEntry, local: LocalCashBookEntry | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) return local;
          return remote;
        },
      },
      {
        label: 'Locations',
        table: 'locations',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          name: (row.name as string) || '',
          location_type: (row.location_type as 'shop' | 'warehouse') || 'shop',
          is_default: row.is_default ? 1 : 0,
          is_active: row.is_active === false ? 0 : 1,
          access_pin_hash: (row.access_pin_hash as string) || null,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.locations,
        merge: async (remote: LocalLocation, local: LocalLocation | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Stock batches',
        table: 'stock_batches',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          product_id: row.product_id as string,
          location_id: row.location_id as string,
          batch_code: (row.batch_code as string) || '',
          expiry_date: (row.expiry_date as string) || null,
          quantity: asQty(row.quantity),
          cost_price: Number(row.cost_price) || 0,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.stock_batches,
        merge: async (remote: LocalStockBatch, local: LocalStockBatch | undefined) => {
          if (!local) return remote;
          if (local.synced !== 0) return remote;
          const localQty = asQty(local.quantity);
          const remoteQty = asQty(remote.quantity);
          // Unsynced local sale: keep the lower qty. Inflated local stock: take cloud.
          if (localQty < remoteQty) return { ...local, quantity: localQty };
          return remote;
        },
      },
      {
        label: 'Stock movements',
        table: 'stock_movements',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          product_id: row.product_id as string,
          batch_id: (row.batch_id as string) || null,
          from_location_id: (row.from_location_id as string) || null,
          to_location_id: (row.to_location_id as string) || null,
          movement_type: row.movement_type as LocalStockMovement['movement_type'],
          quantity: Number(row.quantity) || 0,
          note: (row.note as string) || '',
          user_id: (row.user_id as string) || null,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.stock_movements,
      },
      {
        label: 'Online orders',
        table: 'online_orders',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          order_number: row.order_number as string,
          customer_name: (row.customer_name as string) || '',
          customer_phone: (row.customer_phone as string) || '',
          customer_address: (row.customer_address as string) || '',
          notes: (row.notes as string) || '',
          status: (row.status as LocalOnlineOrder['status']) || 'new',
          payment_method: (row.payment_method as string) || 'pay_on_delivery',
          total_amount: Number(row.total_amount) || 0,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.online_orders,
        merge: async (remote: LocalOnlineOrder, local: LocalOnlineOrder | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Online order items',
        table: 'online_order_items',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          order_id: row.order_id as string,
          product_id: (row.product_id as string) || null,
          product_name: (row.product_name as string) || '',
          unit_price: Number(row.unit_price) || 0,
          quantity: Number(row.quantity) || 0,
          subtotal: Number(row.subtotal) || 0,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.online_order_items,
      },
    ] as const;

    for (const config of tables) {
      if (opts?.onlyTables && !opts.onlyTables.includes(config.table)) continue;
      if (!opts?.includeHistory && config.table === 'stock_movements') continue;

      const { data, error } = await fetchAllStoreRows(config.table, storeId);

      if (error) {
        errors.push(formatSyncError(config.label, error));
        continue;
      }

      for (const row of data || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = config.map(row) as any;

        // Never resurrect hard-deleted products or their stock rows
        if (config.table === 'products' && deletedProductIds.has(mapped.id as string)) {
          continue;
        }
        if (
          (config.table === 'stock_batches' || config.table === 'stock_movements') &&
          deletedProductIds.has(mapped.product_id as string)
        ) {
          continue;
        }

        const existing = await config.dbTable.get(mapped.id);

        let record = mapped;
        if ('merge' in config && config.merge) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          record = await (config.merge as any)(mapped, existing);
        }

        if (!existing || existing.id === record.id) {
          await config.dbTable.put(record);
          if (!existing) pulledCount++;
        }
      }
    }

    if (errors.length > 0) {
      return { success: false, message: `Partial pull. Errors: ${errors.join('; ')}`, pulledCount };
    }

    await db.sync_meta.put({
      id: 'last_sync',
      last_synced_at: new Date().toISOString(),
    });

    // Cloud snapshot is the shared ledger — replace local extras so devices match
    if (!opts?.skipCatalogAlign) {
      const adopted = await adoptCloudStockLedger(storeId);
      if (!adopted.ok) {
        return {
          success: false,
          message: adopted.error || 'Could not adopt cloud stock',
          pulledCount,
        };
      }
      try {
        const { canonicalizeStoreStock, syncStoreCatalogStockFromBatches } = await import('@/lib/warehouse');
        await canonicalizeStoreStock(storeId);
        await syncStoreCatalogStockFromBatches(storeId);
      } catch {
        // Non-fatal: snapshot still replaced
      }
    }

    return {
      success: true,
      message: pulledCount > 0 ? `Pulled ${pulledCount} new records from cloud` : 'Cloud data is up to date',
      pulledCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Pull failed: ${msg}`, pulledCount: 0 };
  }
}

export async function pullStockLedgerFromCloud(storeId?: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const id = storeId || (await getCurrentStoreId());
  if (!id) return false;

  const adopted = await adoptCloudStockLedger(id);
  return adopted.ok;
}

export async function syncStockFast(): Promise<{ success: boolean; message: string }> {
  const push = await syncToSupabase({ skipPing: true });
  const adopted = await refreshStockFromCloud();
  if (adopted.ok) {
    return { success: true, message: adopted.message };
  }
  if (push.success) {
    return { success: false, message: `Pushed local sales. Pull issue: ${adopted.message}` };
  }
  return { success: false, message: adopted.message || push.message };
}

export async function syncBidirectional(): Promise<{ success: boolean; message: string }> {
  const push = await syncToSupabase();
  const pull = await syncFromSupabase({ skipCatalogAlign: true });
  const adopted = await refreshStockFromCloud();

  if (!pull.success && !push.success && !adopted.ok) {
    return { success: false, message: `Pull: ${pull.message}; Push: ${push.message}` };
  }

  if (!adopted.ok) {
    return { success: false, message: adopted.message || pull.message };
  }

  if (!push.success) {
    return { success: true, message: `${adopted.message}. ${push.message}` };
  }

  return {
    success: true,
    message: `Full sync complete. ${pull.message}. ${push.message}`,
  };
}

export async function restoreStoreFromCloud(
  storeId: string,
  ownerPin: string
): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.' };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.' };
  }

  const { data: remoteStore, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .maybeSingle();

  if (storeError || !remoteStore) {
    return { success: false, message: 'Store not found in cloud. Check your Store ID.' };
  }

  const { data: owners, error: ownerError } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .eq('is_active', true);

  if (ownerError || !owners?.length) {
    return { success: false, message: 'No owner account found for this store.' };
  }

  const pinHash = hashPin(ownerPin);
  const ownerMatch = owners.find(o => o.pin_hash === pinHash);
  if (!ownerMatch) {
    return { success: false, message: 'Invalid owner PIN for this store.' };
  }

  await db.transaction(
    'rw',
    [
      db.stores,
      db.users,
      db.products,
      db.transactions,
      db.transaction_items,
      db.expenses,
      db.cash_book_entries,
      db.locations,
      db.stock_batches,
      db.stock_movements,
      db.online_orders,
      db.online_order_items,
      db.deleted_records,
      db.app_config,
    ],
    async () => {
      await db.stores.clear();
      await db.users.clear();
      await db.products.clear();
      await db.transactions.clear();
      await db.transaction_items.clear();
      await db.expenses.clear();
      await db.cash_book_entries.clear();
      await db.locations.clear();
      await db.stock_batches.clear();
      await db.stock_movements.clear();
      await db.online_orders.clear();
      await db.online_order_items.clear();
      await db.deleted_records.clear();
    }
  );

  await setCurrentStoreId(storeId);
  const pull = await syncFromSupabase({ includeHistory: true });

  if (!pull.success) {
    return { success: false, message: pull.message };
  }

  return {
    success: true,
    message: `Restored "${remoteStore.name}" from cloud. ${pull.message}`,
  };
}

/**
 * Add / refresh another cloud store on this device without wiping existing stores.
 * Verifies owner PIN, pulls that store's data, and switches to it.
 */
export async function addStoreFromCloud(
  storeId: string,
  ownerPin: string
): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.' };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.' };
  }

  const cleanId = storeId.trim();
  if (!cleanId) {
    return { success: false, message: 'Enter a Store ID.' };
  }

  const { data: remoteStore, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('id', cleanId)
    .maybeSingle();

  if (storeError || !remoteStore) {
    return { success: false, message: 'Store not found in cloud. Check your Store ID.' };
  }

  const { data: owners, error: ownerError } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', cleanId)
    .eq('role', 'owner')
    .eq('is_active', true);

  if (ownerError || !owners?.length) {
    return { success: false, message: 'No owner account found for this store.' };
  }

  const pinHash = hashPin(ownerPin);
  const ownerMatch = owners.find((o) => o.pin_hash === pinHash);
  if (!ownerMatch) {
    return { success: false, message: 'Invalid owner PIN for this store.' };
  }

  await setCurrentStoreId(cleanId);
  const pull = await syncFromSupabase({ includeHistory: true });
  if (!pull.success) {
    return { success: false, message: pull.message };
  }

  return {
    success: true,
    message: `Opened "${remoteStore.name}" on this device. ${pull.message}`,
  };
}

export async function getLastSyncTime(): Promise<string | null> {
  const meta = await db.sync_meta.get('last_sync');
  return meta?.last_synced_at ?? null;
}

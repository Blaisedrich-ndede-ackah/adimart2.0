import Dexie, { Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import { isSupabaseConfigured, supabase, testSupabaseConnection } from './supabase';

// Store represents a business/shop
export interface LocalStore {
  id: string;
  name: string;
  address: string;
  support_number: string;
  discount_cap_percentage: number;
  pin_on_discount_enabled: number;
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
  created_at: string;
  updated_at: string;
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

class AdimatDB extends Dexie {
  stores!: Table<LocalStore, string>;
  users!: Table<LocalUser, string>;
  products!: Table<LocalProduct, string>;
  transactions!: Table<LocalTransaction, string>;
  transaction_items!: Table<LocalTransactionItem, string>;
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

// Create a new store with owner
export async function createStoreWithOwner(
  storeName: string,
  ownerName: string,
  ownerPin: string
): Promise<{ store: LocalStore; owner: LocalUser }> {
  const storeId = generateId();
  const ownerId = generateId();
  const now = new Date().toISOString();

  const store: LocalStore = {
    id: storeId,
    name: storeName,
    address: '',
    support_number: '',
    discount_cap_percentage: 10,
    pin_on_discount_enabled: 1,
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
    created_at: now,
    synced: 0,
  };

  await db.stores.add(store);
  await db.users.add(owner);
  await setCurrentStoreId(storeId);

  return { store, owner };
}

// Get all users for a store
export async function getStoreUsers(storeId: string): Promise<LocalUser[]> {
  return db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.is_active === 1)
    .toArray();
}

// Get all users for current store
export async function getCurrentStoreUsers(): Promise<LocalUser[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return getStoreUsers(storeId);
}

// Authenticate user by PIN within current store
export async function authenticateByPin(pin: string): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  
  const pinHash = hashPin(pin);
  const users = await db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.pin_hash === pinHash && u.is_active === 1)
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
  role: 'owner' | 'cashier'
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
    created_at: new Date().toISOString(),
    synced: 0,
  };
  
  await db.users.add(user);
  return user;
}

// Deactivate a user
export async function deactivateUser(userId: string): Promise<void> {
  await db.users.update(userId, { is_active: 0, synced: 0 });
}

// Delete a user
export async function deleteUser(userId: string): Promise<void> {
  await db.users.delete(userId);
}

// Get products for current store
export async function getCurrentStoreProducts(): Promise<LocalProduct[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.products.where('store_id').equals(storeId).toArray();
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

// Get transactions for current store
export async function getCurrentStoreTransactions(): Promise<LocalTransaction[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.transactions.where('store_id').equals(storeId).toArray();
}

// Sync to Supabase
export async function syncToSupabase(): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured. Add environment variables to enable cloud sync.' };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected' };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.' };
  }

  const errors: string[] = [];
  let syncedCount = 0;

  const formatSyncError = (label: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Load failed') || message.includes('Failed to fetch')) {
      return `${label}: Could not reach Supabase. Check your internet connection and VITE_SUPABASE_URL.`;
    }
    return `${label}: ${message}`;
  };

  const upsertRows = async <T extends Record<string, unknown>>(
    label: string,
    table: 'stores' | 'users' | 'products' | 'transactions' | 'transaction_items',
    rows: T[],
    markSynced: () => Promise<void>
  ) => {
    if (rows.length === 0) return;

    try {
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
      if (error) {
        errors.push(formatSyncError(label, error));
        return;
      }

      await markSynced();
      syncedCount += rows.length;
    } catch (error) {
      errors.push(formatSyncError(label, error));
    }
  };

  try {
    const store = await db.stores.get(storeId);
    if (store && store.synced === 0) {
      await upsertRows(
        'Store',
        'stores',
        [{
          id: store.id,
          name: store.name,
          address: store.address,
          support_number: store.support_number,
          discount_cap_percentage: store.discount_cap_percentage,
          pin_on_discount_enabled: store.pin_on_discount_enabled === 1,
          created_at: store.created_at,
        }],
        async () => {
          await db.stores.update(storeId, { synced: 1 });
        }
      );
    }

    const unsyncedUsers = await db.users
      .where('store_id').equals(storeId)
      .and(u => u.synced === 0)
      .toArray();
    await upsertRows(
      'Users',
      'users',
      unsyncedUsers.map(u => ({
        id: u.id,
        store_id: u.store_id,
        name: u.name,
        role: u.role,
        pin_hash: u.pin_hash,
        is_active: u.is_active === 1,
        created_at: u.created_at,
      })),
      async () => {
        await Promise.all(unsyncedUsers.map(u => db.users.update(u.id, { synced: 1 })));
      }
    );

    const unsyncedProducts = await db.products
      .where('store_id').equals(storeId)
      .and(p => p.synced === 0)
      .toArray();
    await upsertRows(
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
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
      async () => {
        await Promise.all(unsyncedProducts.map(p => db.products.update(p.id, { synced: 1 })));
      }
    );

    const unsyncedTxns = await db.transactions
      .where('store_id').equals(storeId)
      .and(t => t.synced === 0)
      .toArray();
    await upsertRows(
      'Transactions',
      'transactions',
      unsyncedTxns.map(t => ({
        id: t.id,
        store_id: t.store_id,
        receipt_number: t.receipt_number,
        cashier_id: t.cashier_id,
        cashier_name: t.cashier_name,
        total_amount: t.total_amount,
        discount_applied: t.discount_applied,
        payment_method: t.payment_method,
        cash_amount: t.cash_amount,
        paystack_amount: t.paystack_amount,
        paystack_reference: t.paystack_reference,
        status: t.status,
        created_at: t.created_at,
      })),
      async () => {
        await Promise.all(unsyncedTxns.map(t => db.transactions.update(t.id, { synced: 1 })));
      }
    );

    const unsyncedItems = await db.transaction_items
      .where('store_id').equals(storeId)
      .and(i => i.synced === 0)
      .toArray();
    await upsertRows(
      'Transaction items',
      'transaction_items',
      unsyncedItems.map(i => ({
        id: i.id,
        store_id: i.store_id,
        transaction_id: i.transaction_id,
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
      })),
      async () => {
        await Promise.all(unsyncedItems.map(i => db.transaction_items.update(i.id, { synced: 1 })));
      }
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

export async function getLastSyncTime(): Promise<string | null> {
  const meta = await db.sync_meta.get('last_sync');
  return meta?.last_synced_at ?? null;
}

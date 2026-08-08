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
  /** Optional compressed JPEG data URL for product photo */
  image_url?: string;
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
  expenses!: Table<LocalExpense, string>;
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
  const newExpense: LocalExpense = {
    id: generateId(),
    store_id: storeId,
    ...expense,
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
  await db.expenses.update(id, {
    ...updates,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id);
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

    await db.products.add({
      id: generateId(),
      store_id: storeId,
      name: row.name.trim(),
      category: row.category.trim() || 'Other',
      sku_type: row.sku_type?.trim() || 'unit',
      barcode: row.barcode.trim(),
      cost_price: row.cost_price,
      selling_price: row.selling_price,
      stock_level: row.stock_level,
      is_active: 1,
      image_url: '',
      created_at: now,
      updated_at: now,
      synced: 0,
    });
    imported++;
  }

  return { imported, skipped };
}

function formatSyncError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Load failed') || message.includes('Failed to fetch')) {
    return `${label}: Could not reach Supabase. Check your internet connection and VITE_SUPABASE_URL.`;
  }
  return `${label}: ${message}`;
}

async function upsertToSupabase<T extends Record<string, unknown>>(
  label: string,
  table: 'stores' | 'users' | 'products' | 'transactions' | 'transaction_items' | 'expenses',
  rows: T[],
  markSynced: () => Promise<void>,
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0;

  try {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
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

  try {
    const store = await db.stores.get(storeId);
    if (store && store.synced === 0) {
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
        created_at: u.created_at,
      })),
      async () => { await Promise.all(unsyncedUsers.map(u => db.users.update(u.id, { synced: 1 }))); },
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
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
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

export async function syncFromSupabase(): Promise<{ success: boolean; message: string; pulledCount: number }> {
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

  try {
    const { data: remoteStore, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .maybeSingle();

    if (storeError) errors.push(formatSyncError('Store', storeError));
    else if (remoteStore) {
      const localStore = await db.stores.get(storeId);
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
        created_at: remoteStore.created_at,
        synced: localStore?.synced === 0 ? 0 : 1,
      });
      pulledCount++;
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
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.users,
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
            created_at: local.created_at as string,
            updated_at: (local.updated_at as string) || (local.created_at as string),
            synced: 1,
          };
        },
        dbTable: db.products,
        merge: async (remote: LocalProduct, local: LocalProduct | undefined) => {
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
    ] as const;

    for (const config of tables) {
      const { data, error } = await supabase
        .from(config.table)
        .select('*')
        .eq('store_id', storeId);

      if (error) {
        errors.push(formatSyncError(config.label, error));
        continue;
      }

      for (const row of data || []) {
        const mapped = config.map(row) as LocalUser & LocalProduct & LocalTransaction & LocalTransactionItem & LocalExpense;
        const existing = await config.dbTable.get(mapped.id);

        let record = mapped;
        if ('merge' in config && config.merge) {
          record = await (config.merge as (r: typeof mapped, l: typeof existing) => Promise<typeof mapped>)(mapped, existing);
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

export async function syncBidirectional(): Promise<{ success: boolean; message: string }> {
  const pull = await syncFromSupabase();
  const push = await syncToSupabase();

  if (!pull.success && !push.success) {
    return { success: false, message: `Pull: ${pull.message}; Push: ${push.message}` };
  }

  if (!pull.success) {
    return { success: push.success, message: `Pushed to cloud. Pull issue: ${pull.message}` };
  }

  if (!push.success) {
    return { success: false, message: `Pulled from cloud. Push issue: ${push.message}` };
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

  await db.transaction('rw', [db.stores, db.users, db.products, db.transactions, db.transaction_items, db.expenses, db.app_config], async () => {
    await db.stores.clear();
    await db.users.clear();
    await db.products.clear();
    await db.transactions.clear();
    await db.transaction_items.clear();
    await db.expenses.clear();
  });

  await setCurrentStoreId(storeId);
  const pull = await syncFromSupabase();

  if (!pull.success) {
    return { success: false, message: pull.message };
  }

  return {
    success: true,
    message: `Restored "${remoteStore.name}" from cloud. ${pull.message}`,
  };
}

export async function getLastSyncTime(): Promise<string | null> {
  const meta = await db.sync_meta.get('last_sync');
  return meta?.last_synced_at ?? null;
}

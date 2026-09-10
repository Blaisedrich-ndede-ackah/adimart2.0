/**
 * Cloud-backed admin portal data layer.
 * Aggregates all stores, users, products, and Paystack revenue for remittances.
 */

import { isSupabaseConfigured, supabase } from './supabase';
import { generateId, hashPin } from './dexie';
import {
  getSubscriptionInfo,
  type SubscriptionStatus,
} from './subscription';
import { resolveStoreOwnerPhone } from './mnotify';
import {
  loadAllStoreQuotas,
  normalizeStoreQuota,
  saveStoreQuotas,
  type StoreQuotaLimits,
} from './storeQuotas';

export interface AdminStoreRow {
  id: string;
  name: string;
  address: string;
  support_number: string;
  momo_account_name: string;
  momo_number: string;
  momo_network: string;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  subscription_months_granted: number;
  /** Admin lock pending subscription payment */
  access_blocked: boolean;
  /** Admin-managed warehouse / multi-location capability */
  warehouse_enabled: boolean;
  max_shops: number;
  max_warehouses: number;
  /** Admin-managed cap on how many business stores the owner may create */
  max_stores: number;
  /** Admin-managed public e-commerce storefront */
  ecommerce_enabled: boolean;
  ecommerce_slug: string;
  created_at: string;
  /** Super-admin wipe of trial sales; ISO timestamp when last cleared */
  transactions_cleared_at: string | null;
}

export interface AdminSubscriptionGrantRow {
  id: string;
  store_id: string;
  months: number;
  period_start: string;
  period_end: string;
  notes: string;
  granted_at: string;
}

export interface StoreSubscriptionUsage {
  store: AdminStoreRow;
  status: SubscriptionStatus;
  daysLeft: number | null;
  isExpiringSoon: boolean;
  isExpired: boolean;
  monthsGranted: number;
  grantCount: number;
  lastGrantedAt: string | null;
  accessBlocked: boolean;
  /** Completed sales during the current subscription window */
  periodSales: number;
  periodRevenue: number;
  userCount: number;
  productCount: number;
}

export interface AdminUserRow {
  id: string;
  store_id: string;
  name: string;
  role: 'owner' | 'cashier';
  is_active: boolean;
  phone: string;
  created_at: string;
}

export interface AdminProductRow {
  id: string;
  store_id: string;
  name: string;
  category: string;
  selling_price: number;
  stock_level: number;
  is_active: boolean;
  barcode: string;
}

export interface AdminTransactionRow {
  id: string;
  store_id: string;
  total_amount: number;
  cash_amount: number;
  paystack_amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  receipt_number: string;
}

export interface AdminPayoutRow {
  id: string;
  store_id: string;
  week_start: string;
  week_end: string;
  paystack_total: number;
  momo_account_name: string;
  momo_number: string;
  momo_network: string;
  status: 'pending' | 'sent';
  notes: string;
  marked_at: string | null;
}

export interface StorePerformance {
  store: AdminStoreRow;
  userCount: number;
  productCount: number;
  saleCount: number;
  totalRevenue: number;
  cashRevenue: number;
  paystackRevenue: number;
  weekPaystack: number;
  weekSales: number;
  payoutStatus: 'pending' | 'sent' | 'none';
  payoutId?: string;
}

export interface AdminDashboardData {
  stores: AdminStoreRow[];
  users: AdminUserRow[];
  products: AdminProductRow[];
  transactions: AdminTransactionRow[];
  payouts: AdminPayoutRow[];
  subscriptionGrants: AdminSubscriptionGrantRow[];
  performance: StorePerformance[];
  subscriptions: StoreSubscriptionUsage[];
  totals: {
    stores: number;
    users: number;
    products: number;
    sales: number;
    revenue: number;
    paystack: number;
    weekPaystack: number;
    pendingPayouts: number;
    subsActive: number;
    subsExpiringSoon: number;
    subsExpired: number;
    subsNone: number;
    storesBlocked: number;
  };
  weekStart: string;
  weekEnd: string;
}

/** Monday 00:00 local as YYYY-MM-DD */
export function getWeekStart(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return toDateOnly(d);
}

/** Sunday end of the week containing `weekStart` */
export function getWeekEnd(weekStart: string): string {
  const d = parseDateOnly(weekStart);
  d.setDate(d.getDate() + 6);
  return toDateOnly(d);
}

export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const d = parseDateOnly(weekStart);
  d.setDate(d.getDate() + deltaWeeks * 7);
  return toDateOnly(d);
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function inWeek(iso: string, weekStart: string, weekEnd: string): boolean {
  const day = iso.slice(0, 10);
  return day >= weekStart && day <= weekEnd;
}

async function fetchAllRows<T>(table: string, select = '*'): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: T[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const chunk = (data || []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function loadAdminDashboard(weekStart = getWeekStart()): Promise<AdminDashboardData> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY so the admin portal can load cloud data.');
  }

  const weekEnd = getWeekEnd(weekStart);

  const [storesRaw, usersRaw, productsRaw, txRaw, payoutsRaw, grantsRaw, quotasByStore] =
    await Promise.all([
      fetchAllRows<Record<string, unknown>>('stores'),
      fetchAllRows<Record<string, unknown>>('users'),
      fetchAllRows<Record<string, unknown>>('products'),
      fetchAllRows<Record<string, unknown>>('transactions'),
      fetchAllRows<Record<string, unknown>>('payouts').catch(() => [] as Record<string, unknown>[]),
      fetchAllRows<Record<string, unknown>>('subscription_grants').catch(
        () => [] as Record<string, unknown>[]
      ),
      loadAllStoreQuotas(),
    ]);

  const stores: AdminStoreRow[] = storesRaw.map((s) => {
    const id = String(s.id);
    const fromStores = normalizeStoreQuota({
      warehouse_enabled: Boolean(s.warehouse_enabled),
      max_shops: Number(s.max_shops) || 1,
      max_warehouses: Number(s.max_warehouses) || 0,
      max_stores: Number(s.max_stores) || 1,
    });
    const quota = quotasByStore[id] || fromStores;
    return {
      id,
      name: String(s.name || 'Unnamed store'),
      address: String(s.address || ''),
      support_number: String(s.support_number || ''),
      momo_account_name: String(s.momo_account_name || ''),
      momo_number: String(s.momo_number || ''),
      momo_network: String(s.momo_network || ''),
      subscription_started_at: s.subscription_started_at ? String(s.subscription_started_at) : null,
      subscription_expires_at: s.subscription_expires_at ? String(s.subscription_expires_at) : null,
      subscription_months_granted: Number(s.subscription_months_granted) || 0,
      access_blocked: Boolean(s.access_blocked),
      warehouse_enabled: quota.warehouse_enabled,
      ecommerce_enabled: Boolean(s.ecommerce_enabled),
      ecommerce_slug: String(s.ecommerce_slug || ''),
      max_shops: quota.max_shops,
      max_warehouses: quota.max_warehouses,
      max_stores: quota.max_stores,
      created_at: String(s.created_at || ''),
      transactions_cleared_at: s.transactions_cleared_at ? String(s.transactions_cleared_at) : null,
    };
  });

  const users: AdminUserRow[] = usersRaw.map((u) => ({
    id: String(u.id),
    store_id: String(u.store_id),
    name: String(u.name || ''),
    role: (u.role === 'cashier' ? 'cashier' : 'owner') as 'owner' | 'cashier',
    is_active: Boolean(u.is_active),
    phone: String(u.phone || ''),
    created_at: String(u.created_at || ''),
  }));

  const products: AdminProductRow[] = productsRaw.map((p) => ({
    id: String(p.id),
    store_id: String(p.store_id),
    name: String(p.name || ''),
    category: String(p.category || ''),
    selling_price: Number(p.selling_price) || 0,
    stock_level: Number(p.stock_level) || 0,
    is_active: Boolean(p.is_active),
    barcode: String(p.barcode || ''),
  }));

  const transactions: AdminTransactionRow[] = txRaw
    .filter((t) => String(t.status || 'completed') === 'completed')
    .map((t) => ({
      id: String(t.id),
      store_id: String(t.store_id),
      total_amount: Number(t.total_amount) || 0,
      cash_amount: Number(t.cash_amount) || 0,
      paystack_amount: Number(t.paystack_amount) || 0,
      payment_method: String(t.payment_method || ''),
      status: String(t.status || ''),
      created_at: String(t.created_at || ''),
      receipt_number: String(t.receipt_number || ''),
    }));

  const payouts: AdminPayoutRow[] = payoutsRaw.map((p) => ({
    id: String(p.id),
    store_id: String(p.store_id),
    week_start: String(p.week_start).slice(0, 10),
    week_end: String(p.week_end).slice(0, 10),
    paystack_total: Number(p.paystack_total) || 0,
    momo_account_name: String(p.momo_account_name || ''),
    momo_number: String(p.momo_number || ''),
    momo_network: String(p.momo_network || ''),
    status: p.status === 'sent' ? 'sent' : 'pending',
    notes: String(p.notes || ''),
    marked_at: p.marked_at ? String(p.marked_at) : null,
  }));

  const subscriptionGrants: AdminSubscriptionGrantRow[] = grantsRaw
    .map((g) => ({
      id: String(g.id),
      store_id: String(g.store_id),
      months: Number(g.months) || 0,
      period_start: String(g.period_start || ''),
      period_end: String(g.period_end || ''),
      notes: String(g.notes || ''),
      granted_at: String(g.granted_at || g.created_at || ''),
    }))
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at));

  const performance: StorePerformance[] = stores.map((store) => {
    const storeTx = transactions.filter((t) => t.store_id === store.id);
    const weekTx = storeTx.filter((t) => inWeek(t.created_at, weekStart, weekEnd));
    const payout = payouts.find((p) => p.store_id === store.id && p.week_start === weekStart);

    const totalRevenue = storeTx.reduce((s, t) => s + t.total_amount, 0);
    const paystackRevenue = storeTx.reduce((s, t) => s + t.paystack_amount, 0);
    const cashRevenue = storeTx.reduce((s, t) => s + t.cash_amount, 0);
    const weekPaystack = weekTx.reduce((s, t) => s + t.paystack_amount, 0);

    const payoutStatus: StorePerformance['payoutStatus'] = payout
      ? payout.status
      : weekPaystack > 0
        ? 'pending'
        : 'none';

    return {
      store,
      userCount: users.filter((u) => u.store_id === store.id).length,
      productCount: products.filter((p) => p.store_id === store.id).length,
      saleCount: storeTx.length,
      totalRevenue,
      cashRevenue,
      paystackRevenue,
      weekPaystack,
      weekSales: weekTx.length,
      payoutStatus,
      payoutId: payout?.id,
    };
  }).sort((a, b) => b.weekPaystack - a.weekPaystack || b.totalRevenue - a.totalRevenue);

  const weekPaystackTotal = performance.reduce((s, p) => s + p.weekPaystack, 0);

  const subscriptions: StoreSubscriptionUsage[] = stores.map((store) => {
    const info = getSubscriptionInfo(store.subscription_expires_at, store.subscription_started_at);
    const storeGrants = subscriptionGrants.filter((g) => g.store_id === store.id);
    const periodStart = store.subscription_started_at;
    const periodEnd = store.subscription_expires_at;
    const periodTx = transactions.filter((t) => {
      if (t.store_id !== store.id) return false;
      if (!periodStart) return false;
      if (t.created_at < periodStart) return false;
      if (periodEnd && t.created_at > periodEnd) return false;
      return true;
    });

    return {
      store,
      status: info.status,
      daysLeft: info.daysLeft,
      isExpiringSoon: info.isExpiringSoon,
      isExpired: info.isExpired,
      monthsGranted: store.subscription_months_granted,
      grantCount: storeGrants.length,
      lastGrantedAt: storeGrants[0]?.granted_at || null,
      accessBlocked: store.access_blocked,
      periodSales: periodTx.length,
      periodRevenue: periodTx.reduce((s, t) => s + t.total_amount, 0),
      userCount: users.filter((u) => u.store_id === store.id).length,
      productCount: products.filter((p) => p.store_id === store.id).length,
    };
  }).sort((a, b) => {
    const rank = (s: SubscriptionStatus) => (s === 'expired' ? 0 : s === 'active' ? 1 : 2);
    const rankDiff = rank(a.status) - rank(b.status);
    if (rankDiff !== 0) return rankDiff;
    if (a.daysLeft != null && b.daysLeft != null) return a.daysLeft - b.daysLeft;
    return a.store.name.localeCompare(b.store.name);
  });

  return {
    stores,
    users,
    products,
    transactions,
    payouts,
    subscriptionGrants,
    performance,
    subscriptions,
    totals: {
      stores: stores.length,
      users: users.length,
      products: products.length,
      sales: transactions.length,
      revenue: transactions.reduce((s, t) => s + t.total_amount, 0),
      paystack: transactions.reduce((s, t) => s + t.paystack_amount, 0),
      weekPaystack: weekPaystackTotal,
      pendingPayouts: performance.filter((p) => p.weekPaystack > 0 && p.payoutStatus !== 'sent').length,
      subsActive: subscriptions.filter((s) => s.status === 'active').length,
      subsExpiringSoon: subscriptions.filter((s) => s.isExpiringSoon).length,
      subsExpired: subscriptions.filter((s) => s.status === 'expired').length,
      subsNone: subscriptions.filter((s) => s.status === 'none').length,
      storesBlocked: stores.filter((s) => s.access_blocked).length,
    },
    weekStart,
    weekEnd,
  };
}

/**
 * Grant (or extend) a store's monthly subscription.
 * Extends from max(now, current expiry). History is recorded in subscription_grants.
 */
export async function grantStoreSubscription(
  store: AdminStoreRow,
  months: number,
  notes = ''
): Promise<{ success: boolean; error?: string; expiresAt?: string }> {
  const { applySubscriptionGrant } = await import('./subscriptionPayments');
  return applySubscriptionGrant({
    storeId: store.id,
    storeName: store.name,
    ownerPhone: resolveStoreOwnerPhone(store),
    months,
    notes: notes || `Admin grant · ${months} month(s)`,
    currentExpiresAt: store.subscription_expires_at,
    currentStartedAt: store.subscription_started_at,
    currentMonthsGranted: store.subscription_months_granted,
  });
}

/**
 * Admin: lock or unlock a store. Blocked stores must pay a package before using the POS.
 */
export async function setStoreAccessBlocked(
  storeId: string,
  blocked: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  const { error } = await supabase
    .from('stores')
    .update({ access_blocked: blocked })
    .eq('id', storeId);

  if (error) {
    return {
      success: false,
      error: error.message.includes('access_blocked')
        ? `${error.message} — run supabase-migrate-store-access-block.sql in Supabase.`
        : error.message,
    };
  }

  const { db } = await import('./dexie');
  const local = await db.stores.get(storeId);
  if (local) {
    await db.stores.put({
      ...local,
      access_blocked: blocked ? 1 : 0,
    });
  }

  return { success: true };
}

async function countStoreRows(table: string, storeId: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId);
  if (error) return 0;
  return count || 0;
}

function migrateClearHint(message: string): string {
  if (
    message.includes('transactions_cleared_at') ||
    message.includes('transactions_delete') ||
    /permission denied|42501/i.test(message)
  ) {
    return `${message} — run supabase-migrate-clear-store-ledger.sql in Supabase.`;
  }
  return message;
}

/**
 * Super-admin: wipe a store's trial sales so reports start empty for live trading.
 * Deletes cloud transactions, line items, expenses, cash book, and payout records,
 * then stamps `transactions_cleared_at` so devices drop the same rows on sync.
 * Products, staff, stock, and subscriptions are left unchanged.
 */
export async function clearStoreTrialLedger(storeId: string): Promise<{
  success: boolean;
  error?: string;
  clearedAt?: string;
  deleted?: { transactions: number; expenses: number; cashBook: number };
}> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const [transactions, expenses, cashBook] = await Promise.all([
    countStoreRows('transactions', storeId),
    countStoreRows('expenses', storeId),
    countStoreRows('cash_book_entries', storeId),
  ]);

  const clearedAt = new Date().toISOString();

  const itemDelete = await supabase.from('transaction_items').delete().eq('store_id', storeId);
  if (itemDelete.error) {
    return { success: false, error: migrateClearHint(itemDelete.error.message) };
  }

  const txnDelete = await supabase.from('transactions').delete().eq('store_id', storeId);
  if (txnDelete.error) {
    return { success: false, error: migrateClearHint(txnDelete.error.message) };
  }

  const expenseDelete = await supabase.from('expenses').delete().eq('store_id', storeId);
  if (expenseDelete.error) {
    return { success: false, error: migrateClearHint(expenseDelete.error.message) };
  }

  const cashDelete = await supabase.from('cash_book_entries').delete().eq('store_id', storeId);
  if (cashDelete.error && !/could not find|does not exist|schema cache/i.test(cashDelete.error.message)) {
    return { success: false, error: migrateClearHint(cashDelete.error.message) };
  }

  const payoutDelete = await supabase.from('payouts').delete().eq('store_id', storeId);
  if (payoutDelete.error && !/could not find|does not exist|schema cache/i.test(payoutDelete.error.message)) {
    return { success: false, error: migrateClearHint(payoutDelete.error.message) };
  }

  const stamp = await supabase
    .from('stores')
    .update({ transactions_cleared_at: clearedAt })
    .eq('id', storeId);

  if (stamp.error) {
    return { success: false, error: migrateClearHint(stamp.error.message) };
  }

  const { applyLocalStoreLedgerClear } = await import('./storeLedgerClear');
  await applyLocalStoreLedgerClear(storeId, clearedAt);

  return {
    success: true,
    clearedAt,
    deleted: { transactions, expenses, cashBook },
  };
}

/**
 * Update admin-managed store / warehouse limits.
 * Writes the canonical `store_quotas` table and verifies the save.
 */
export async function updateStoreWarehouseLimits(
  storeId: string,
  limits: StoreQuotaLimits
): Promise<{ success: boolean; error?: string; limits?: StoreQuotaLimits }> {
  const result = await saveStoreQuotas(storeId, limits);
  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to save store quotas',
    };
  }
  // Soft warning (saved on stores only) still counts as success for the UI
  return {
    success: true,
    error: result.error,
    limits: result.limits,
  };
}

/**
 * Enable/disable public e-commerce for a store (admin only).
 * Optionally set a public slug used in #/shop/{slug}.
 */
export async function updateStoreEcommerce(
  storeId: string,
  settings: {
    ecommerce_enabled: boolean;
    ecommerce_slug?: string;
  }
): Promise<{ success: boolean; error?: string; slug?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  let slug = (settings.ecommerce_slug || '').trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  if (settings.ecommerce_enabled && !slug) {
    const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();
    slug = (store?.name || 'store')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'store';
  }

  if (settings.ecommerce_enabled && slug) {
    const { data: clash } = await supabase
      .from('stores')
      .select('id')
      .eq('ecommerce_slug', slug)
      .neq('id', storeId)
      .maybeSingle();
    if (clash) {
      slug = `${slug}-${storeId.slice(0, 6)}`;
    }
  }

  const { error } = await supabase
    .from('stores')
    .update({
      ecommerce_enabled: Boolean(settings.ecommerce_enabled),
      ecommerce_slug: settings.ecommerce_enabled ? slug : '',
    })
    .eq('id', storeId);

  if (error) {
    return {
      success: false,
      error: error.message.includes('ecommerce_')
        ? `${error.message} — run supabase-migrate-ecommerce.sql in Supabase.`
        : error.message,
    };
  }

  return { success: true, slug };
}

/**
 * Mark a store's weekly Paystack total as remitted to their MoMo account.
 */
export async function markWeeklyPayoutSent(
  store: AdminStoreRow,
  weekStart: string,
  paystackTotal: number,
  notes = ''
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const weekEnd = getWeekEnd(weekStart);
  const payload = {
    id: generateId(),
    store_id: store.id,
    week_start: weekStart,
    week_end: weekEnd,
    paystack_total: paystackTotal,
    momo_account_name: store.momo_account_name || '',
    momo_number: store.momo_number || '',
    momo_network: store.momo_network || '',
    status: 'sent' as const,
    notes,
    marked_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('payouts')
    .upsert(payload, { onConflict: 'store_id,week_start' });

  if (error) {
    // Retry update path if unique conflict shape differs
    const existing = await supabase
      .from('payouts')
      .select('id')
      .eq('store_id', store.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (existing.data?.id) {
      const { error: updateError } = await supabase
        .from('payouts')
        .update({
          paystack_total: paystackTotal,
          momo_account_name: store.momo_account_name || '',
          momo_number: store.momo_number || '',
          momo_network: store.momo_network || '',
          status: 'sent',
          notes,
          marked_at: new Date().toISOString(),
          week_end: weekEnd,
        })
        .eq('id', existing.data.id);

      if (updateError) return { success: false, error: updateError.message };
      return { success: true };
    }

    return { success: false, error: error.message };
  }

  return { success: true };
}

export function formatGhs(amount: number): string {
  return `GH₵${amount.toFixed(2)}`;
}

export interface LinkedUserStores {
  phone: string;
  displayName: string;
  roles: string[];
  storeIds: string[];
  storeNames: string[];
  userCount: number;
}

function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/** Group users by phone to show which additional stores the same person opened. */
export function buildLinkedUserStores(
  users: AdminUserRow[],
  stores: AdminStoreRow[]
): LinkedUserStores[] {
  const nameOf = (id: string) => stores.find((s) => s.id === id)?.name || 'Unknown';
  const byPhone = new Map<string, AdminUserRow[]>();

  for (const user of users) {
    const phone = normalizePhoneDigits(user.phone || '');
    if (!phone) continue;
    const list = byPhone.get(phone) || [];
    list.push(user);
    byPhone.set(phone, list);
  }

  return Array.from(byPhone.entries())
    .map(([phone, rows]) => {
      const storeIds = [...new Set(rows.map((r) => r.store_id))];
      const names = [...new Set(rows.map((r) => r.name.trim()).filter(Boolean))];
      return {
        phone,
        displayName: names[0] || 'User',
        roles: [...new Set(rows.map((r) => r.role))],
        storeIds,
        storeNames: storeIds.map(nameOf),
        userCount: rows.length,
      };
    })
    .sort(
      (a, b) =>
        b.storeIds.length - a.storeIds.length || a.displayName.localeCompare(b.displayName)
    );
}

/** Admin: set staff active/blocked for a store. */
export async function setAdminUserActive(
  userId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  const { error } = await supabase
    .from('users')
    .update({ is_active: isActive })
    .eq('id', userId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Admin: add a cashier to a store. */
export async function addAdminStoreCashier(
  storeId: string,
  name: string,
  pin: string,
  phone = ''
): Promise<{ success: boolean; error?: string; user?: AdminUserRow }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  if (!name.trim()) return { success: false, error: 'Enter staff name' };
  if (!/^\d{4}$/.test(pin)) return { success: false, error: 'PIN must be 4 digits' };

  const id = generateId();
  const now = new Date().toISOString();
  const row = {
    id,
    store_id: storeId,
    name: name.trim(),
    role: 'cashier',
    pin_hash: hashPin(pin),
    is_active: true,
    phone: phone.trim(),
    assigned_location_id: null,
    can_wholesale: false,
    can_sell_from_warehouse: false,
    can_manage_ecommerce: false,
    created_at: now,
  };

  const { error } = await supabase.from('users').insert(row);
  if (error) {
    return {
      success: false,
      error: error.message.includes('phone')
        ? `${error.message} — run supabase-migrate-user-phone-admin-otp.sql`
        : error.message,
    };
  }

  return {
    success: true,
    user: {
      id,
      store_id: storeId,
      name: row.name,
      role: 'cashier',
      is_active: true,
      phone: row.phone,
      created_at: now,
    },
  };
}

/** Admin: reset a staff PIN. */
export async function resetAdminUserPin(
  userId: string,
  pin: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  if (!/^\d{4}$/.test(pin)) return { success: false, error: 'PIN must be 4 digits' };
  const { error } = await supabase
    .from('users')
    .update({ pin_hash: hashPin(pin) })
    .eq('id', userId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Admin: update product active flag / stock for a store inventory row. */
export async function updateAdminProduct(
  productId: string,
  patch: { is_active?: boolean; stock_level?: number }
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;
  if (patch.stock_level !== undefined) {
    const stock = Math.max(0, Math.floor(Number(patch.stock_level) || 0));
    payload.stock_level = stock;
  }
  const { error } = await supabase.from('products').update(payload).eq('id', productId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export interface AdminCreateStoreInput {
  storeName: string;
  address: string;
  supportNumber: string;
  ownerName: string;
  ownerPhone: string;
  ownerPin: string;
}

export interface AdminCreatedStore {
  storeId: string;
  storeName: string;
  ownerName: string;
  ownerPhone: string;
  supportNumber: string;
  address: string;
}

/**
 * Super-admin: create a store and owner account in the cloud.
 * The owner restores it on a device with the Store ID + PIN.
 */
export async function createAdminStore(
  input: AdminCreateStoreInput
): Promise<{ success: boolean; error?: string; created?: AdminCreatedStore }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const storeName = input.storeName.trim();
  const address = input.address.trim();
  const supportNumber = input.supportNumber.trim();
  const ownerName = input.ownerName.trim();
  const ownerPhone = input.ownerPhone.trim();
  const ownerPin = input.ownerPin.trim();

  if (!storeName) return { success: false, error: 'Enter a store name' };
  if (!address) return { success: false, error: 'Enter a store address' };
  if (!supportNumber) return { success: false, error: 'Enter a support phone number' };
  if (!ownerName) return { success: false, error: 'Enter the owner name' };
  if (!/^\d{4}$/.test(ownerPin)) return { success: false, error: 'Owner PIN must be 4 digits' };

  const storeId = generateId();
  const ownerId = generateId();
  const now = new Date().toISOString();

  const storeRow = {
    id: storeId,
    name: storeName,
    address,
    support_number: supportNumber,
    discount_cap_percentage: 10,
    pin_on_discount_enabled: true,
    discount_allow_percentage: true,
    discount_allow_fixed: true,
    cashier_can_discount: true,
    momo_account_name: '',
    momo_number: '',
    momo_network: '',
    subscription_months_granted: 0,
    access_blocked: false,
    logo_url: '',
    warehouse_enabled: false,
    max_shops: 1,
    max_warehouses: 0,
    max_stores: 1,
    ecommerce_enabled: false,
    ecommerce_slug: '',
    ecommerce_tagline: '',
    currency_code: 'GHS',
    preferred_language: 'en',
    created_at: now,
  };

  const { error: storeError } = await supabase.from('stores').insert(storeRow);
  if (storeError) {
    return { success: false, error: storeError.message };
  }

  const userRow = {
    id: ownerId,
    store_id: storeId,
    name: ownerName,
    role: 'owner' as const,
    pin_hash: hashPin(ownerPin),
    is_active: true,
    phone: ownerPhone,
    assigned_location_id: null,
    can_wholesale: true,
    can_sell_from_warehouse: true,
    can_manage_ecommerce: true,
    created_at: now,
  };

  const { error: userError } = await supabase.from('users').insert(userRow);
  if (userError) {
    await supabase.from('stores').delete().eq('id', storeId);
    return {
      success: false,
      error: userError.message.includes('phone')
        ? `${userError.message} — run supabase-migrate-user-phone-admin-otp.sql`
        : userError.message,
    };
  }

  try {
    await saveStoreQuotas(storeId, {
      warehouse_enabled: false,
      max_shops: 1,
      max_warehouses: 0,
      max_stores: 1,
    });
  } catch {
    // Quota table is optional; store is still usable.
  }

  return {
    success: true,
    created: {
      storeId,
      storeName,
      ownerName,
      ownerPhone,
      supportNumber,
      address,
    },
  };
}

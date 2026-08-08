/**
 * Cloud-backed admin portal data layer.
 * Aggregates all stores, users, products, and Paystack revenue for remittances.
 */

import { isSupabaseConfigured, supabase } from './supabase';
import { generateId } from './dexie';

export interface AdminStoreRow {
  id: string;
  name: string;
  address: string;
  support_number: string;
  momo_account_name: string;
  momo_number: string;
  momo_network: string;
  created_at: string;
}

export interface AdminUserRow {
  id: string;
  store_id: string;
  name: string;
  role: 'owner' | 'cashier';
  is_active: boolean;
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
  performance: StorePerformance[];
  totals: {
    stores: number;
    users: number;
    products: number;
    sales: number;
    revenue: number;
    paystack: number;
    weekPaystack: number;
    pendingPayouts: number;
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

  const [storesRaw, usersRaw, productsRaw, txRaw, payoutsRaw] = await Promise.all([
    fetchAllRows<Record<string, unknown>>('stores'),
    fetchAllRows<Record<string, unknown>>('users'),
    fetchAllRows<Record<string, unknown>>('products'),
    fetchAllRows<Record<string, unknown>>('transactions'),
    fetchAllRows<Record<string, unknown>>('payouts').catch(() => [] as Record<string, unknown>[]),
  ]);

  const stores: AdminStoreRow[] = storesRaw.map((s) => ({
    id: String(s.id),
    name: String(s.name || 'Unnamed store'),
    address: String(s.address || ''),
    support_number: String(s.support_number || ''),
    momo_account_name: String(s.momo_account_name || ''),
    momo_number: String(s.momo_number || ''),
    momo_network: String(s.momo_network || ''),
    created_at: String(s.created_at || ''),
  }));

  const users: AdminUserRow[] = usersRaw.map((u) => ({
    id: String(u.id),
    store_id: String(u.store_id),
    name: String(u.name || ''),
    role: (u.role === 'cashier' ? 'cashier' : 'owner') as 'owner' | 'cashier',
    is_active: Boolean(u.is_active),
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

  return {
    stores,
    users,
    products,
    transactions,
    payouts,
    performance,
    totals: {
      stores: stores.length,
      users: users.length,
      products: products.length,
      sales: transactions.length,
      revenue: transactions.reduce((s, t) => s + t.total_amount, 0),
      paystack: transactions.reduce((s, t) => s + t.paystack_amount, 0),
      weekPaystack: weekPaystackTotal,
      pendingPayouts: performance.filter((p) => p.weekPaystack > 0 && p.payoutStatus !== 'sent').length,
    },
    weekStart,
    weekEnd,
  };
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

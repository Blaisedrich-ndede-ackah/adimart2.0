import { createClient, type Session } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const shopperSupabase = createClient(url || 'https://placeholder.supabase.co', anon || 'placeholder-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'adimat-shopper-auth',
  },
});

export interface ShopAccount {
  id: string;
  name: string;
  phone: string;
  email: string;
  store_id: string;
  customer_id: string;
}

export interface ShopTransaction {
  id: string;
  entry_type: 'topup' | 'purchase' | 'refund' | 'adjustment';
  direction: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  description: string;
  payment_reference: string;
  created_at: string;
  order_id?: string | null;
  customer_id?: string;
}

export interface ShopOrder {
  id: string;
  order_number: string;
  status: string;
  payment_method: string;
  total_amount: number;
  wallet_amount: number;
  paystack_amount: number;
  created_at: string;
}

export interface ShopProfile {
  account: ShopAccount;
  balance: number;
  transactions: ShopTransaction[];
  orders: ShopOrder[];
}

function shopErrorText(payload: { error?: unknown; message?: unknown }, status: number): string {
  const raw = payload.error ?? payload.message;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const message = String((raw as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return `The shop could not complete that request (${status}).`;
}

async function post<T>(path: string, body: Record<string, unknown>, token = ''): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await response.text();
  let payload = {} as T & { error?: unknown; message?: unknown };
  if (raw) {
    try {
      payload = JSON.parse(raw) as T & { error?: unknown; message?: unknown };
    } catch {
      payload = { error: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) } as T & { error?: unknown };
    }
  }
  if (!response.ok || payload.error) {
    throw new Error(shopErrorText(payload, response.status));
  }
  return payload;
}

export async function rememberSession(session: { access_token: string; refresh_token: string } | null): Promise<Session | null> {
  if (!session?.access_token || !session.refresh_token) return null;
  const { data, error } = await shopperSupabase.auth.setSession(session);
  if (error) throw new Error(error.message);
  return data.session;
}

export async function currentShopToken(): Promise<string> {
  const { data } = await shopperSupabase.auth.getSession();
  return data.session?.access_token || '';
}

export async function shopSignOut(): Promise<void> {
  await shopperSupabase.auth.signOut();
}

export function shopSignup(input: {
  storeId: string;
  name: string;
  phone: string;
  email: string;
  password: string;
}): Promise<{ needsOtp?: boolean; phone?: string; session?: { access_token: string; refresh_token: string } } & Partial<ShopProfile>> {
  return post('/api/shop-auth', { action: 'signup', ...input });
}

export function shopRequestOtp(storeId: string, phone: string): Promise<{ needsOtp: boolean; phone: string }> {
  return post('/api/shop-auth', { action: 'request-otp', storeId, phone });
}

export function shopVerifyOtp(storeId: string, phone: string, token: string): Promise<{ session?: { access_token: string; refresh_token: string } } & Partial<ShopProfile>> {
  return post('/api/shop-auth', { action: 'verify-otp', storeId, phone, token });
}

export function shopLogin(storeId: string, identifier: string, password: string): Promise<{ session?: { access_token: string; refresh_token: string }; needsOtp?: boolean; phone?: string; message?: string } & Partial<ShopProfile>> {
  return post('/api/shop-auth', { action: 'login-password', storeId, identifier, password });
}

export function shopResetEmail(email: string, redirectTo: string): Promise<{ ok: boolean }> {
  return post('/api/shop-auth', { action: 'reset-email', email, redirectTo });
}

export function shopUpdatePassword(password: string, token: string): Promise<{ ok: boolean }> {
  return post('/api/shop-auth', { action: 'update-password', password }, token);
}

export function shopMe(storeId: string, token: string): Promise<ShopProfile> {
  return post('/api/shop-auth', { action: 'me', storeId }, token);
}

export function shopStartTopup(storeId: string, amount: number, token: string): Promise<{ authorizationUrl: string; reference: string }> {
  return post('/api/shop-wallet', { action: 'start-topup', storeId, amount }, token);
}

export function shopVerifyPayment(storeId: string, reference: string, token = ''): Promise<{ balance: number; orderNumber?: string; creditedWallet: boolean }> {
  return post('/api/shop-wallet', { action: 'verify', storeId, reference }, token);
}

export function shopCheckout(input: {
  storeId: string;
  method: 'delivery' | 'wallet' | 'paystack' | 'mixed';
  name: string;
  phone: string;
  address: string;
  notes: string;
  items: { product_id: string; quantity: number }[];
  walletAmount?: number;
  token?: string;
}): Promise<{ orderNumber?: string; balance?: number; authorizationUrl?: string; reference?: string; paystackAmount?: number; walletAmount?: number }> {
  const { token, ...body } = input;
  return post('/api/shop-checkout', body, token || '');
}

export function shopOwnerLedger(storeId: string, ownerUserId: string, customerId = ''): Promise<{
  accounts: Array<{ customer_id: string; name: string; phone: string; email: string; balance: number }>;
  transactions: ShopTransaction[];
}> {
  return post('/api/shop-owner', { storeId, ownerUserId, customerId });
}

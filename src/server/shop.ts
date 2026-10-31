import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { parseGhanaPhone } from '../lib/ghanaPhone';

export interface ApiRequest {
  method?: string;
  url?: string;
  body?: unknown;
  rawBody?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end?: (body?: string) => void;
}

const memoryAttempts = new Map<string, number[]>();
const TOPUP_MIN_PESEWAS = 100;
const TOPUP_MAX_PESEWAS = 500_000;
const LOGIN_LIMIT = 8;
const OTP_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

function cleanEnv(value: string | undefined): string {
  return (value || '').trim().replace(/^["']+|["']+$/g, '');
}

function header(req: ApiRequest, name: string): string {
  const value = req.headers[name.toLowerCase()] ?? req.headers[name];
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function clientIp(req: ApiRequest): string {
  const forwarded = header(req, 'x-forwarded-for');
  return (forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

function projectUrl(): string {
  const raw = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

function anonKey(): string {
  return cleanEnv(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
}

function serviceKey(): string {
  return cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function paystackSecret(): string {
  return cleanEnv(process.env.PAYSTACK_SECRET_KEY);
}

function service(): SupabaseClient {
  const url = projectUrl();
  const key = serviceKey();
  if (!url || !key) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL on the server. Do not prefix the service role key with VITE_.');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function anonAuth(): SupabaseClient {
  const url = projectUrl();
  const key = anonKey();
  if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function pesewasToGhs(pesewas: number): number {
  return Math.round(pesewas) / 100;
}

function originOf(req: ApiRequest): string {
  const proto = header(req, 'x-forwarded-proto') || 'https';
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return '';
  return `${proto}://${host}`;
}

function bearer(req: ApiRequest): string {
  const value = header(req, 'authorization');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function userFromToken(token: string): Promise<User> {
  if (!token) throw new Error('Sign in is required.');
  const { data, error } = await service().auth.getUser(token);
  if (error || !data.user) throw new Error('Sign in is required.');
  return data.user;
}

function sessionPayload(session: { access_token: string; refresh_token: string; expires_in?: number } | null) {
  if (!session?.access_token || !session.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in || 3600,
  };
}

async function throttle(action: string, ip: string, subject = ''): Promise<void> {
  const limit = action.includes('otp') ? OTP_LIMIT : LOGIN_LIMIT;
  const key = `${action}|${ip}|${subject}`;
  const now = Date.now();
  const recent = (memoryAttempts.get(key) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= limit) {
    throw new Error('Too many attempts. Wait 15 minutes and try again.');
  }
  recent.push(now);
  memoryAttempts.set(key, recent);

  try {
    const admin = service();
    const since = new Date(now - WINDOW_MS).toISOString();
    let query = admin
      .from('shop_auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('action', action)
      .gte('created_at', since);
    query = subject ? query.eq('subject', subject) : query.eq('ip', ip);
    const { count, error } = await query;
    if (error) return;
    if ((count || 0) >= limit) {
      throw new Error('Too many attempts. Wait 15 minutes and try again.');
    }
    await admin.from('shop_auth_attempts').insert({ ip, action, subject });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Too many')) throw error;
  }
}

async function loadStore(storeId: string): Promise<{ id: string; name: string; ecommerce_enabled: boolean; ecommerce_slug: string }> {
  const { data, error } = await service()
    .from('stores')
    .select('id, name, ecommerce_enabled, ecommerce_slug')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ecommerce_enabled) throw new Error('This shop is not available online.');
  return data;
}

async function findCustomer(storeId: string, phone: ReturnType<typeof parseGhanaPhone>): Promise<{ id: string; wallet_balance: number } | null> {
  if (!phone) return null;
  const { data, error } = await service()
    .from('customers')
    .select('id, phone, wallet_balance')
    .eq('store_id', storeId)
    .ilike('phone', `%${phone.digits}`);
  if (error) throw new Error(error.message);
  const match = (data || []).find((row) => {
    const parsed = parseGhanaPhone(String(row.phone || ''));
    return parsed?.e164 === phone.e164;
  });
  return match ? { id: String(match.id), wallet_balance: Number(match.wallet_balance) || 0 } : null;
}

async function ensureCustomer(storeId: string, name: string, phone: NonNullable<ReturnType<typeof parseGhanaPhone>>): Promise<{ id: string; wallet_balance: number }> {
  const existing = await findCustomer(storeId, phone);
  if (existing) {
    await service().from('customers').update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id);
    return existing;
  }
  const id = crypto.randomUUID();
  const full = {
    id,
    store_id: storeId,
    name,
    phone: phone.local,
    opening_balance: 0,
    opening_balance_remaining: 0,
    wallet_balance: 0,
    is_active: true,
  };
  let { error } = await service().from('customers').insert(full);
  if (error && /column|schema cache/i.test(error.message)) {
    ({ error } = await service().from('customers').insert({
      id,
      store_id: storeId,
      name,
      phone: phone.local,
      is_active: true,
    }));
  }
  if (error) throw new Error(error.message || 'Could not save the customer for this shop.');
  return { id, wallet_balance: 0 };
}

interface ShopAccountRow {
  id: string;
  auth_user_id: string;
  store_id: string;
  customer_id: string;
  name: string;
  phone: string;
  email: string;
}

async function accountForUser(storeId: string, userId: string): Promise<ShopAccountRow | null> {
  const { data, error } = await service()
    .from('shop_accounts')
    .select('id, auth_user_id, store_id, customer_id, name, phone, email')
    .eq('store_id', storeId)
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ShopAccountRow | null) || null;
}

async function createShopAccount(user: User, storeId: string): Promise<ShopAccountRow> {
  const existing = await accountForUser(storeId, user.id);
  if (existing) return existing;
  const { data: other } = await service()
    .from('shop_accounts')
    .select('store_id')
    .eq('auth_user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (other && other.store_id !== storeId) {
    throw new Error('This login is already registered with another shop.');
  }
  const meta = user.user_metadata || {};
  const metaStore = text(meta.store_id, 80);
  if (metaStore && metaStore !== storeId) {
    throw new Error('This login is already registered with another shop.');
  }
  const phone = parseGhanaPhone(String(user.phone || meta.phone || ''));
  const name = text(meta.name, 120);
  const email = text(meta.email, 255).toLowerCase();
  if (!phone || name.length < 2) throw new Error('Confirm your phone number to finish creating the account.');
  const customer = await ensureCustomer(storeId, name, phone);
  const id = crypto.randomUUID();
  const row = {
    id,
    auth_user_id: user.id,
    store_id: storeId,
    customer_id: customer.id,
    name,
    phone: phone.e164,
    email,
  };
  const { error } = await service().from('shop_accounts').insert(row);
  if (error) {
    const again = await accountForUser(storeId, user.id);
    if (again) return again;
    throw new Error(error.message || 'Could not save the shop account. Run supabase-migrate-shop-accounts.sql in the Supabase SQL editor.');
  }
  return row;
}

function shopLoginEmail(phone: NonNullable<ReturnType<typeof parseGhanaPhone>>, email: string): string {
  return email || `shopper+${phone.digits}@adimatpos.com`;
}

async function signInShopper(input: {
  phone: ReturnType<typeof parseGhanaPhone>;
  email: string;
  password: string;
}): Promise<{ user: User; session: { access_token: string; refresh_token: string; expires_in?: number } } | null> {
  const auth = anonAuth();
  const tryPassword = async (credentials: { phone: string; password: string } | { email: string; password: string }) => {
    const { data } = await auth.auth.signInWithPassword(credentials);
    if (!data.user || !data.session) return null;
    return { user: data.user, session: data.session };
  };
  if (input.phone) {
    const byPhone = await tryPassword({ phone: input.phone.e164, password: input.password });
    if (byPhone) return byPhone;
    const synthetic = await tryPassword({ email: shopLoginEmail(input.phone, ''), password: input.password });
    if (synthetic) return synthetic;
  }
  if (input.email) {
    const byEmail = await tryPassword({ email: input.email, password: input.password });
    if (byEmail) return byEmail;
  }
  return null;
}

async function requireAccount(req: ApiRequest, storeId: string): Promise<{ user: User; account: ShopAccountRow }> {
  const user = await userFromToken(bearer(req));
  const account = await accountForUser(storeId, user.id);
  if (!account) throw new Error('Create an account for this shop before using the wallet.');
  return { user, account };
}

function paystackEmail(email: string, phone: string, reference: string): string {
  if (/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email) && !email.endsWith('.local')) return email;
  const suffix = (phone || reference).replace(/\W/g, '').slice(-12);
  return `shopper+${suffix}@adimatpos.com`;
}

async function paystackInitialize(input: {
  email: string;
  pesewas: number;
  reference: string;
  metadata: Record<string, string>;
  callbackUrl: string;
}): Promise<{ authorization_url: string; reference: string }> {
  const secret = paystackSecret();
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      amount: input.pesewas,
      currency: 'GHS',
      reference: input.reference,
      channels: ['card', 'mobile_money', 'bank'],
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: { authorization_url?: string; reference?: string } };
  if (!response.ok || !payload.status || !payload.data?.authorization_url) {
    throw new Error(payload.message || 'Paystack could not start the payment.');
  }
  return { authorization_url: payload.data.authorization_url, reference: payload.data.reference || input.reference };
}

interface VerifiedCharge {
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

async function paystackVerify(reference: string): Promise<VerifiedCharge> {
  const secret = paystackSecret();
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await response.json() as {
    status?: boolean;
    message?: string;
    data?: { reference?: string; amount?: number; currency?: string; status?: string };
  };
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || 'Paystack could not verify this payment.');
  }
  return {
    reference: String(payload.data.reference || reference),
    amount: Number(payload.data.amount) || 0,
    currency: String(payload.data.currency || ''),
    status: String(payload.data.status || ''),
  };
}

function signaturesMatch(raw: string, signature: string): boolean {
  const secret = paystackSecret();
  if (!secret || !signature) return false;
  const digest = createHmac('sha512', secret).update(raw).digest('hex');
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function postWallet(input: {
  storeId: string;
  customerId: string;
  type: 'topup' | 'purchase' | 'refund' | 'adjustment';
  direction: 'credit' | 'debit';
  amount: number;
  reference: string;
  description: string;
  orderId?: string | null;
}): Promise<number> {
  const { data, error } = await service().rpc('post_shop_wallet_entry', {
    p_store: input.storeId,
    p_customer: input.customerId,
    p_type: input.type,
    p_direction: input.direction,
    p_amount: money(input.amount),
    p_reference: input.reference,
    p_description: input.description,
    p_order: input.orderId || null,
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

interface PricedItem {
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

async function priceCart(storeId: string, items: unknown): Promise<{ items: PricedItem[]; total: number }> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
    throw new Error('Add at least one product.');
  }
  const requested = items.map((item) => {
    const row = objectBody(item);
    const quantity = Math.floor(Number(row.quantity));
    return { product_id: text(row.product_id, 80), quantity };
  });
  if (requested.some((item) => !item.product_id || item.quantity < 1 || item.quantity > 99)) {
    throw new Error('Check the quantities in your cart.');
  }
  const ids = [...new Set(requested.map((item) => item.product_id))];
  const { data, error } = await service()
    .from('products')
    .select('id, name, selling_price, stock_level, is_active, sell_online')
    .eq('store_id', storeId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data || []).map((row) => [String(row.id), row]));
  const priced: PricedItem[] = requested.map((item) => {
    const product = byId.get(item.product_id);
    if (!product || !product.is_active || !product.sell_online) {
      throw new Error('A product in the cart is no longer available.');
    }
    const stock = Number(product.stock_level) || 0;
    if (stock < item.quantity) throw new Error(`${product.name} does not have enough stock.`);
    const unit = money(Number(product.selling_price) || 0);
    if (unit <= 0) throw new Error(`${product.name} cannot be bought online.`);
    return {
      product_id: item.product_id,
      product_name: String(product.name || 'Item'),
      unit_price: unit,
      quantity: item.quantity,
      subtotal: money(unit * item.quantity),
    };
  });
  const total = money(priced.reduce((sum, item) => sum + item.subtotal, 0));
  if (total <= 0) throw new Error('This order total is not valid.');
  return { items: priced, total };
}

async function insertOrder(input: {
  storeId: string;
  customerId?: string | null;
  shopAccountId?: string | null;
  name: string;
  phone: string;
  address: string;
  notes: string;
  items: PricedItem[];
  total: number;
  paymentMethod: string;
  walletAmount: number;
  paystackAmount: number;
  paystackReference: string;
}): Promise<{ id: string; order_number: string }> {
  if (input.paystackReference) {
    const { data: existing } = await service()
      .from('online_orders')
      .select('id, order_number')
      .eq('paystack_reference', input.paystackReference)
      .maybeSingle();
    if (existing?.id) return { id: String(existing.id), order_number: String(existing.order_number) };
  }
  const id = crypto.randomUUID();
  const orderNumber = `ON-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();
  const { error } = await service().from('online_orders').insert({
    id,
    store_id: input.storeId,
    order_number: orderNumber,
    customer_name: input.name,
    customer_phone: input.phone,
    customer_address: input.address,
    notes: input.notes,
    status: 'new',
    payment_method: input.paymentMethod,
    total_amount: input.total,
    customer_id: input.customerId || null,
    shop_account_id: input.shopAccountId || null,
    wallet_amount: input.walletAmount,
    paystack_amount: input.paystackAmount,
    paystack_reference: input.paystackReference,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    if (input.paystackReference && /duplicate|unique/i.test(error.message)) {
      const { data: existing } = await service()
        .from('online_orders')
        .select('id, order_number')
        .eq('paystack_reference', input.paystackReference)
        .maybeSingle();
      if (existing?.id) return { id: String(existing.id), order_number: String(existing.order_number) };
    }
    throw new Error(error.message);
  }
  const { error: itemError } = await service().from('online_order_items').insert(input.items.map((item) => ({
    id: crypto.randomUUID(),
    store_id: input.storeId,
    order_id: id,
    product_id: item.product_id,
    product_name: item.product_name,
    unit_price: item.unit_price,
    quantity: item.quantity,
    subtotal: item.subtotal,
    created_at: now,
  })));
  if (itemError) throw new Error(itemError.message);
  return { id, order_number: orderNumber };
}

async function accountProfile(account: ShopAccountRow) {
  const { data: customer } = await service()
    .from('customers')
    .select('wallet_balance, name, phone')
    .eq('id', account.customer_id)
    .maybeSingle();
  const { data: entries } = await service()
    .from('shop_wallet_entries')
    .select('id, entry_type, direction, amount, balance_after, description, payment_reference, created_at, order_id')
    .eq('customer_id', account.customer_id)
    .order('created_at', { ascending: false })
    .limit(40);
  const { data: orders } = await service()
    .from('online_orders')
    .select('id, order_number, status, payment_method, total_amount, wallet_amount, paystack_amount, created_at')
    .eq('customer_id', account.customer_id)
    .order('created_at', { ascending: false })
    .limit(30);
  return {
    account: {
      id: account.id,
      name: account.name,
      phone: account.phone,
      email: account.email,
      store_id: account.store_id,
      customer_id: account.customer_id,
    },
    balance: money(Number(customer?.wallet_balance) || 0),
    transactions: entries || [],
    orders: orders || [],
  };
}

async function finalizeIntent(reference: string, charge: VerifiedCharge): Promise<{ balance: number; orderNumber?: string; creditedWallet: boolean } | null> {
  const { data: intent, error } = await service()
    .from('shop_payment_intents')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!intent) return null;
  if (intent.status === 'verified') {
    const profile = intent.customer_id
      ? await service().from('customers').select('wallet_balance').eq('id', intent.customer_id).maybeSingle()
      : { data: null };
    let orderNumber = '';
    if (intent.order_id) {
      const { data: order } = await service().from('online_orders').select('order_number').eq('id', intent.order_id).maybeSingle();
      orderNumber = String(order?.order_number || '');
    }
    return { balance: money(Number(profile.data?.wallet_balance) || 0), orderNumber: orderNumber || undefined, creditedWallet: intent.purpose === 'topup' };
  }
  if (charge.status !== 'success') throw new Error('Paystack has not confirmed this payment yet.');
  if (charge.currency && charge.currency !== 'GHS') throw new Error('The payment currency was not Ghana cedis.');
  if (charge.reference !== reference || charge.amount !== Number(intent.amount_pesewas)) {
    throw new Error('The Paystack amount does not match the shop charge.');
  }

  if (intent.purpose === 'topup') {
    if (!intent.customer_id) throw new Error('This top-up is missing a customer.');
    const balance = await postWallet({
      storeId: String(intent.store_id),
      customerId: String(intent.customer_id),
      type: 'topup',
      direction: 'credit',
      amount: pesewasToGhs(charge.amount),
      reference,
      description: 'Paystack wallet top-up',
    });
    await service().from('shop_payment_intents').update({
      status: 'verified',
      verified_at: new Date().toISOString(),
    }).eq('id', intent.id);
    return { balance, creditedWallet: true };
  }

  const payload = (intent.payload || {}) as {
    name?: string;
    phone?: string;
    address?: string;
    notes?: string;
    items?: PricedItem[];
    total?: number;
  };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total = money(Number(payload.total) || 0);
  const walletGhs = money(pesewasToGhs(Number(intent.wallet_pesewas) || 0));
  const paidGhs = money(pesewasToGhs(charge.amount));
  if (money(walletGhs + paidGhs) !== total || items.length === 0) {
    throw new Error('This checkout no longer matches the payment.');
  }

  if (walletGhs > 0 && intent.customer_id) {
    const { data: customer } = await service().from('customers').select('wallet_balance').eq('id', intent.customer_id).maybeSingle();
    if (money(Number(customer?.wallet_balance) || 0) < walletGhs) {
      const balance = await postWallet({
        storeId: String(intent.store_id),
        customerId: String(intent.customer_id),
        type: 'topup',
        direction: 'credit',
        amount: paidGhs,
        reference: `${reference}:held`,
        description: 'Paystack payment held in wallet because the wallet portion was no longer available',
      });
      await service().from('shop_payment_intents').update({ status: 'verified', verified_at: new Date().toISOString() }).eq('id', intent.id);
      return { balance, creditedWallet: true };
    }
  }

  const order = await insertOrder({
    storeId: String(intent.store_id),
    customerId: intent.customer_id ? String(intent.customer_id) : null,
    shopAccountId: intent.shop_account_id ? String(intent.shop_account_id) : null,
    name: text(payload.name, 120),
    phone: text(payload.phone, 20),
    address: text(payload.address, 300),
    notes: text(payload.notes, 500),
    items,
    total,
    paymentMethod: walletGhs > 0 ? 'wallet_paystack' : 'paystack',
    walletAmount: walletGhs,
    paystackAmount: paidGhs,
    paystackReference: reference,
  });
  let balance = 0;
  if (walletGhs > 0 && intent.customer_id) {
    balance = await postWallet({
      storeId: String(intent.store_id),
      customerId: String(intent.customer_id),
      type: 'purchase',
      direction: 'debit',
      amount: walletGhs,
      reference: `${reference}:wallet`,
      description: `Wallet portion of order ${order.order_number}`,
      orderId: order.id,
    });
  } else if (intent.customer_id) {
    const { data: customer } = await service().from('customers').select('wallet_balance').eq('id', intent.customer_id).maybeSingle();
    balance = money(Number(customer?.wallet_balance) || 0);
  }
  await service().from('shop_payment_intents').update({
    status: 'verified',
    verified_at: new Date().toISOString(),
    order_id: order.id,
  }).eq('id', intent.id);
  return { balance, orderNumber: order.order_number, creditedWallet: false };
}

export async function handleShopAuth(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = objectBody(req.body);
    const action = text(body.action, 40);
    const storeId = text(body.storeId, 80);
    const ip = clientIp(req);
    if (action === 'me') {
      const { account } = await requireAccount(req, storeId);
      return json(res, 200, await accountProfile(account));
    }
    if (!storeId && action !== 'reset-email' && action !== 'update-password') {
      throw new Error('Choose a shop first.');
    }
    if (storeId) await loadStore(storeId);

    if (action === 'signup') {
      const name = text(body.name, 120);
      const phone = parseGhanaPhone(text(body.phone, 20));
      const email = text(body.email, 255).toLowerCase();
      const password = String(body.password ?? '');
      if (name.length < 2) throw new Error('Enter your name.');
      if (!phone) throw new Error('Enter a Ghana mobile number, for example 0244123456.');
      if (email && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) throw new Error('Enter a valid email or leave it blank.');
      if (password.length < 8 || password.length > 72) throw new Error('Use a password of 8 to 72 characters.');
      await throttle('signup', ip, phone.e164);
      const loginEmail = shopLoginEmail(phone, email);
      const metadata = { name, phone: phone.e164, email, store_id: storeId, login_email: loginEmail };
      const admin = service();
      const withPhone = await admin.auth.admin.createUser({
        email: loginEmail,
        phone: phone.e164,
        password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: metadata,
      });
      let createMessage = withPhone.error?.message || '';
      if (withPhone.error && /phone|sms|provider/i.test(createMessage)) {
        const withoutPhone = await admin.auth.admin.createUser({
          email: loginEmail,
          password,
          email_confirm: true,
          user_metadata: metadata,
        });
        createMessage = withoutPhone.error?.message || '';
      }
      const signed = await signInShopper({ phone, email: loginEmail, password });
      if (!signed) {
        if (/already|registered|exists|duplicate/i.test(createMessage)) {
          throw new Error('This phone or email already has an account. Log in with the same password.');
        }
        throw new Error(createMessage || 'Could not create the account.');
      }
      const account = await createShopAccount({
        ...signed.user,
        phone: signed.user.phone || phone.e164,
        user_metadata: { ...signed.user.user_metadata, ...metadata },
      }, storeId);
      return json(res, 200, { session: sessionPayload(signed.session), ...(await accountProfile(account)) });
    }

    if (action === 'request-otp') {
      const phone = parseGhanaPhone(text(body.phone, 20));
      if (!phone) throw new Error('Enter a Ghana mobile number.');
      await throttle('otp', ip, phone.e164);
      const { error } = await anonAuth().auth.signInWithOtp({
        phone: phone.e164,
        options: { shouldCreateUser: false, channel: 'sms' },
      });
      if (error) throw new Error(error.message);
      return json(res, 200, { needsOtp: true, phone: phone.e164 });
    }

    if (action === 'verify-otp') {
      const phone = parseGhanaPhone(text(body.phone, 20));
      const token = text(body.token, 10);
      if (!phone) throw new Error('Enter a Ghana mobile number.');
      if (!/^\d{6}$/.test(token)) throw new Error('Enter the 6-digit code from the SMS.');
      await throttle('otp-verify', ip, phone.e164);
      const { data, error } = await anonAuth().auth.verifyOtp({ phone: phone.e164, token, type: 'sms' });
      if (error || !data.user || !data.session) throw new Error(error?.message || 'The code was not accepted.');
      const account = await createShopAccount(data.user, storeId);
      return json(res, 200, { session: sessionPayload(data.session), ...(await accountProfile(account)) });
    }

    if (action === 'login-password') {
      const identifier = text(body.identifier, 255);
      const password = String(body.password ?? '');
      const phone = parseGhanaPhone(identifier);
      const email = identifier.includes('@') ? identifier.toLowerCase() : '';
      if (!phone && !email) throw new Error('Enter the phone number or email on the account.');
      if (!password) throw new Error('Enter your password.');
      await throttle('login', ip, phone?.e164 || email);
      const signed = await signInShopper({ phone, email, password });
      if (!signed) throw new Error('Phone, email, or password is incorrect.');
      let account = await accountForUser(storeId, signed.user.id);
      if (!account) {
        const pendingPhone = parseGhanaPhone(String(signed.user.phone || signed.user.user_metadata?.phone || phone?.e164 || ''));
        if (!pendingPhone) throw new Error('Confirm your phone number to finish creating the account.');
        account = await createShopAccount({
          ...signed.user,
          phone: signed.user.phone || pendingPhone.e164,
          user_metadata: {
            ...signed.user.user_metadata,
            name: text(signed.user.user_metadata?.name, 120) || 'Shopper',
            phone: pendingPhone.e164,
            store_id: storeId,
          },
        }, storeId);
      }
      return json(res, 200, { session: sessionPayload(signed.session), ...(await accountProfile(account)) });
    }

    if (action === 'reset-email') {
      const email = text(body.email, 255).toLowerCase();
      const redirectTo = text(body.redirectTo, 300);
      if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) throw new Error('Enter the email on the account.');
      await throttle('reset', ip, email);
      const { error } = await anonAuth().auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }

    if (action === 'update-password') {
      const password = String(body.password ?? '');
      if (password.length < 8 || password.length > 72) throw new Error('Use a password of 8 to 72 characters.');
      const user = await userFromToken(bearer(req));
      await throttle('password', ip, user.id);
      const { error } = await service().auth.admin.updateUserById(user.id, { password });
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: 'Unknown account action.' });
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : '';
    return json(res, 400, { error: message || 'Account request failed.' });
  }
}

export async function handleShopWallet(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = objectBody(req.body);
    const action = text(body.action, 40);
    const storeId = text(body.storeId, 80);
    const store = await loadStore(storeId);
    if (action === 'verify') {
      const reference = text(body.reference, 80);
      if (!/^WAL-[A-Z0-9-]+$/.test(reference) && !/^CHK-[A-Z0-9-]+$/.test(reference)) {
        throw new Error('Payment reference is not valid.');
      }
      const charge = await paystackVerify(reference);
      const result = await finalizeIntent(reference, charge);
      if (!result) return json(res, 404, { error: 'This payment does not belong to the shop.' });
      return json(res, 200, result);
    }
    const { account } = await requireAccount(req, storeId);
    if (action !== 'start-topup') return json(res, 400, { error: 'Unknown wallet action.' });
    const amount = money(Number(body.amount));
    const pesewas = Math.round(amount * 100);
    if (pesewas < TOPUP_MIN_PESEWAS || pesewas > TOPUP_MAX_PESEWAS) {
      throw new Error('Enter a top-up from GH₵ 1 to GH₵ 5,000.');
    }
    const reference = `WAL-${randomBytes(8).toString('hex').toUpperCase()}`;
    const { error } = await service().from('shop_payment_intents').insert({
      id: crypto.randomUUID(),
      store_id: storeId,
      customer_id: account.customer_id,
      shop_account_id: account.id,
      reference,
      purpose: 'topup',
      amount_pesewas: pesewas,
      wallet_pesewas: 0,
      payload: { name: account.name, phone: account.phone },
      status: 'pending',
    });
    if (error) throw new Error(error.message);
    const slug = store.ecommerce_slug || 'shop';
    const started = await paystackInitialize({
      email: paystackEmail(account.email, account.phone, reference),
      pesewas,
      reference,
      callbackUrl: `${originOf(req)}/api/paystack-return?shop=${encodeURIComponent(slug)}`,
      metadata: {
        store_id: storeId,
        customer_id: account.customer_id,
        purpose: 'topup',
        reference,
      },
    });
    return json(res, 200, { authorizationUrl: started.authorization_url, reference });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Wallet request failed.' });
  }
}

export async function handleShopCheckout(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = objectBody(req.body);
    const storeId = text(body.storeId, 80);
    const store = await loadStore(storeId);
    const method = text(body.method, 30);
    const name = text(body.name, 120);
    const phone = parseGhanaPhone(text(body.phone, 20));
    const address = text(body.address, 300);
    const notes = text(body.notes, 500);
    if (name.length < 2) throw new Error('Enter your name.');
    if (!phone) throw new Error('Enter a Ghana mobile number.');
    if (address.length < 4) throw new Error('Enter a delivery address.');
    const priced = await priceCart(storeId, body.items);
    const token = bearer(req);
    let account: ShopAccountRow | null = null;
    if (token) {
      const user = await userFromToken(token);
      account = await accountForUser(storeId, user.id);
    }

    if (method === 'delivery') {
      const order = await insertOrder({
        storeId,
        customerId: account?.customer_id,
        shopAccountId: account?.id,
        name,
        phone: phone.local,
        address,
        notes,
        items: priced.items,
        total: priced.total,
        paymentMethod: 'pay_on_delivery',
        walletAmount: 0,
        paystackAmount: 0,
        paystackReference: '',
      });
      return json(res, 200, { orderNumber: order.order_number, paymentMethod: 'pay_on_delivery' });
    }

    if (!account) throw new Error('Sign in to pay with your wallet or Paystack.');
    const { data: customer, error: customerError } = await service()
      .from('customers')
      .select('wallet_balance')
      .eq('id', account.customer_id)
      .maybeSingle();
    if (customerError) throw new Error(customerError.message);
    const balance = money(Number(customer?.wallet_balance) || 0);

    if (method === 'wallet') {
      if (balance < priced.total) throw new Error('Your wallet balance does not cover this order.');
      const order = await insertOrder({
        storeId,
        customerId: account.customer_id,
        shopAccountId: account.id,
        name,
        phone: phone.local,
        address,
        notes,
        items: priced.items,
        total: priced.total,
        paymentMethod: 'wallet',
        walletAmount: priced.total,
        paystackAmount: 0,
        paystackReference: '',
      });
      let nextBalance = balance;
      try {
        nextBalance = await postWallet({
          storeId,
          customerId: account.customer_id,
          type: 'purchase',
          direction: 'debit',
          amount: priced.total,
          reference: `order:${order.id}:wallet`,
          description: `Wallet payment for order ${order.order_number}`,
          orderId: order.id,
        });
      } catch (walletError) {
        await service().from('online_orders').update({
          status: 'cancelled',
          notes: 'Wallet debit did not complete',
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        throw walletError;
      }
      return json(res, 200, { orderNumber: order.order_number, balance: nextBalance, paymentMethod: 'wallet' });
    }

    const walletRequested = method === 'mixed' ? money(Number(body.walletAmount)) : 0;
    if (method !== 'paystack' && method !== 'mixed') throw new Error('Choose a payment method.');
    if (method === 'mixed') {
      if (walletRequested <= 0 || walletRequested >= priced.total) {
        throw new Error('Use a wallet amount that is less than the order total.');
      }
      if (balance < walletRequested) throw new Error('Your wallet balance does not cover that portion.');
    }
    const walletPesewas = Math.round(walletRequested * 100);
    const payPesewas = Math.round(priced.total * 100) - walletPesewas;
    const reference = `CHK-${randomBytes(8).toString('hex').toUpperCase()}`;
    const { error } = await service().from('shop_payment_intents').insert({
      id: crypto.randomUUID(),
      store_id: storeId,
      customer_id: account.customer_id,
      shop_account_id: account.id,
      reference,
      purpose: 'checkout',
      amount_pesewas: payPesewas,
      wallet_pesewas: walletPesewas,
      payload: {
        name,
        phone: phone.local,
        address,
        notes,
        items: priced.items,
        total: priced.total,
      },
      status: 'pending',
    });
    if (error) throw new Error(error.message);
    const started = await paystackInitialize({
      email: paystackEmail(account.email, account.phone, reference),
      pesewas: payPesewas,
      reference,
      callbackUrl: `${originOf(req)}/api/paystack-return?shop=${encodeURIComponent(store.ecommerce_slug || 'shop')}`,
      metadata: {
        store_id: storeId,
        customer_id: account.customer_id,
        purpose: 'checkout',
        reference,
      },
    });
    return json(res, 200, {
      authorizationUrl: started.authorization_url,
      reference,
      paystackAmount: pesewasToGhs(payPesewas),
      walletAmount: walletRequested,
    });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Checkout failed.' });
  }
}

export async function handlePaystackWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const raw = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  if (!signaturesMatch(raw, header(req, 'x-paystack-signature'))) {
    return json(res, 401, { error: 'Invalid Paystack signature.' });
  }
  try {
    const event = JSON.parse(raw) as { event?: string; data?: { reference?: string; amount?: number; currency?: string; status?: string } };
    if (event.event === 'charge.success' && event.data?.reference) {
      await finalizeIntent(String(event.data.reference), {
        reference: String(event.data.reference),
        amount: Number(event.data.amount) || 0,
        currency: String(event.data.currency || ''),
        status: String(event.data.status || ''),
      });
    }
    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Webhook failed.' });
  }
}

export function handlePaystackReturn(req: ApiRequest, res: ApiResponse): void {
  const url = new URL(req.url || '/', 'https://shop.local');
  const shop = (url.searchParams.get('shop') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  const reference = text(url.searchParams.get('reference') || url.searchParams.get('trxref'), 80);
  res.status(302);
  res.setHeader('Location', `/#/shop/${shop}?reference=${encodeURIComponent(reference)}`);
  if (res.end) res.end();
  else res.json({ redirect: true });
}

export async function handleShopOwner(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = objectBody(req.body);
    const storeId = text(body.storeId, 80);
    const ownerUserId = text(body.ownerUserId, 80);
    const customerId = text(body.customerId, 80);
    if (!storeId || !ownerUserId) throw new Error('Store staff sign-in is required.');
    const { data: staff, error } = await service()
      .from('users')
      .select('id, role, is_active, store_id')
      .eq('id', ownerUserId)
      .eq('store_id', storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!staff || staff.role !== 'owner' || staff.is_active === false) {
      throw new Error('Only the shop owner can view wallet activity.');
    }
    let accountQuery = service()
      .from('shop_accounts')
      .select('id, customer_id, name, phone, email, created_at')
      .eq('store_id', storeId);
    if (customerId) accountQuery = accountQuery.eq('customer_id', customerId);
    const { data: accounts, error: accountError } = await accountQuery;
    if (accountError) throw new Error(accountError.message);
    const customerIds = (accounts || []).map((row) => String(row.customer_id));
    const { data: entries } = customerIds.length
      ? await service()
        .from('shop_wallet_entries')
        .select('id, customer_id, entry_type, direction, amount, balance_after, description, payment_reference, created_at')
        .eq('store_id', storeId)
        .in('customer_id', customerIds)
        .order('created_at', { ascending: false })
        .limit(80)
      : { data: [] };
    const { data: customers } = customerIds.length
      ? await service().from('customers').select('id, wallet_balance').in('id', customerIds)
      : { data: [] };
    const balances = new Map((customers || []).map((row) => [String(row.id), money(Number(row.wallet_balance) || 0)]));
    return json(res, 200, {
      accounts: (accounts || []).map((row) => ({
        ...row,
        balance: balances.get(String(row.customer_id)) || 0,
      })),
      transactions: entries || [],
    });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Could not load wallets.' });
  }
}

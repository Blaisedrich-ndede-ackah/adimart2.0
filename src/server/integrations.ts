import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, createPrivateKey, randomBytes, randomUUID, pbkdf2Sync, sign, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (value: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

const RESOURCE_SCOPES = ['products:read', 'products:write', 'customers:read', 'customers:write', 'transactions:read', 'stores:read'] as const;
type Resource = 'products' | 'customers' | 'transactions' | 'stores';
const READ_FIELDS: Record<Resource, string[]> = {
  products: ['id', 'store_id', 'name', 'category', 'barcode', 'selling_price', 'stock_level', 'reorder_level', 'is_active', 'updated_at', 'created_at'],
  customers: ['id', 'store_id', 'name', 'phone', 'location_id', 'is_active', 'created_at', 'updated_at'],
  transactions: ['id', 'store_id', 'receipt_number', 'cashier_name', 'total_amount', 'discount_applied', 'tax_total', 'payment_method', 'status', 'created_at'],
  stores: ['id', 'name', 'address', 'support_number', 'currency_code', 'created_at'],
};
const WRITE_FIELDS: Partial<Record<Resource, Set<string>>> = {
  products: new Set(['name', 'category', 'barcode', 'selling_price', 'cost_price', 'reorder_level', 'is_active']),
  customers: new Set(['name', 'phone', 'location_id', 'is_active']),
};

function clean(value: string | undefined): string { return (value || '').trim().replace(/^['"]+|['"]+$/g, ''); }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }
function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A JSON object is required.');
  return value as Record<string, unknown>;
}
function database(): SupabaseClient {
  const rawUrl = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.');
  const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return createClient(`${parsed.origin}${path}`, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function webhookEncryptionKey(): Buffer {
  const value = clean(process.env.WEBHOOK_ENCRYPTION_KEY);
  if (!value) throw new Error('Set WEBHOOK_ENCRYPTION_KEY on the server before adding webhook endpoints.');
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('WEBHOOK_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.');
  return key;
}
function encryptWebhookSecret(secret: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', webhookEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
function decryptWebhookSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Webhook secret could not be decrypted.');
  const decryptor = createDecipheriv('aes-256-gcm', webhookEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decryptor.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decryptor.update(Buffer.from(encryptedText, 'base64url')), decryptor.final()]).toString('utf8');
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function legacyPinHash(pin: string): string {
  let value = 0;
  for (const char of `adimat_salt_${pin}_pos`) value = ((value << 5) - value + char.charCodeAt(0)) | 0;
  return Math.abs(value).toString(36);
}
function checkPin(pin: string, encoded: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false;
  if (!encoded.startsWith('pbkdf2-sha256$')) return safeEqual(legacyPinHash(pin), encoded);
  const [, iterationsText, saltText, expectedText] = encoded.split('$');
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !expectedText) return false;
  try {
    const expected = Buffer.from(expectedText, 'base64');
    const actual = pbkdf2Sync(pin, Buffer.from(saltText, 'base64'), iterations, 32, 'sha256');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
async function requireOwner(db: SupabaseClient, input: Record<string, unknown>): Promise<{ storeId: string; userId: string }> {
  const storeId = typeof input.store_id === 'string' ? input.store_id : '';
  const userId = typeof input.user_id === 'string' ? input.user_id : '';
  const pin = typeof input.owner_pin === 'string' ? input.owner_pin : '';
  if (!storeId || !userId || !/^\d{4}$/.test(pin)) throw new Error('Enter your four-digit owner PIN to continue.');
  const { data: pinAttempt, error: attemptError } = await db.from('api_management_pin_attempts').select('lock_until').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
  if (attemptError) throw attemptError;
  if (pinAttempt?.lock_until && new Date(pinAttempt.lock_until).getTime() > Date.now()) throw new Error('Too many incorrect PIN attempts. Try again in fifteen minutes.');
  const { data, error } = await db.from('users').select('id,pin_hash,role,is_active').eq('id', userId).eq('store_id', storeId).maybeSingle();
  if (error) throw error;
  if (!data || data.role !== 'owner' || (data.is_active !== true && data.is_active !== 1)) throw new Error('Owner PIN was not accepted.');
  if (!checkPin(pin, String(data.pin_hash || ''))) {
    const { error: recordError } = await db.rpc('record_adimat_api_pin_failure', { p_store_id: storeId, p_user_id: userId });
    if (recordError) throw recordError;
    throw new Error('Owner PIN was not accepted.');
  }
  await db.from('api_management_pin_attempts').delete().eq('store_id', storeId).eq('user_id', userId);
  return { storeId, userId };
}
async function requireStoreUser(db: SupabaseClient, storeId: string, userId: string): Promise<void> {
  const { data, error } = await db.from('users').select('id').eq('id', userId).eq('store_id', storeId).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('The signed-in user was not found for this store.'), { statusCode: 403 });
}
function publicUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid HTTPS webhook URL.');
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isIP(hostname)) {
    throw new Error('Webhook URLs must use a public HTTPS hostname.');
  }
  return url.toString();
}
function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  }
  const value = address.toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('::ffff:');
}
async function validatedWebhookUrl(value: unknown): Promise<string> {
  const url = publicUrl(value);
  const resolved = await lookup(new URL(url).hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(({ address }) => privateAddress(address))) throw new Error('Webhook host must resolve only to public IP addresses.');
  return url;
}
function cleanScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > RESOURCE_SCOPES.length) throw new Error('Select at least one API permission.');
  const scopes = value.filter((item): item is string => typeof item === 'string');
  if (scopes.some((scope) => !(RESOURCE_SCOPES as readonly string[]).includes(scope)) || new Set(scopes).size !== scopes.length) throw new Error('One or more API permissions are invalid.');
  return scopes;
}
function pickAllowed(value: unknown, allowed: Set<string>): Record<string, unknown> {
  const input = bodyObject(value); const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(input)) if (allowed.has(key)) output[key] = field;
  if (Object.keys(output).length === 0) throw new Error('No supported fields were supplied.');
  return output;
}

async function manage(db: SupabaseClient, input: Record<string, unknown>, response: ApiResponse): Promise<void> {
  const { storeId, userId } = await requireOwner(db, input);
  const action = String(input.action || '');
  if (action === 'list') {
    const [keys, hooks, deliveries] = await Promise.all([
      db.from('api_keys').select('id,name,scopes_json,last_used_at,created_at,revoked_at').eq('store_id', storeId).order('created_at', { ascending: false }),
      db.from('webhooks').select('id,url,events_json,is_active,created_at').eq('store_id', storeId).order('created_at', { ascending: false }),
      db.from('webhook_deliveries').select('id,webhook_id,event,response_status,last_error,attempts,next_attempt_at,delivered_at,created_at').eq('store_id', storeId).order('created_at', { ascending: false }).limit(30),
    ]);
    if (keys.error) throw keys.error; if (hooks.error) throw hooks.error; if (deliveries.error) throw deliveries.error;
    response.status(200).json({ api_keys: keys.data || [], webhooks: hooks.data || [], deliveries: deliveries.data || [] }); return;
  }
  if (action === 'create_key') {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (!name) throw new Error('Name this API key.');
    const scopes = cleanScopes(input.scopes);
    const key = `adm_live_${randomBytes(32).toString('base64url')}`;
    const { data, error } = await db.from('api_keys').insert({ store_id: storeId, name, key_hash: hash(key), scopes_json: scopes, created_by: userId }).select('id,name,scopes_json,created_at').single();
    if (error) throw error;
    response.status(201).json({ api_key: key, record: data }); return;
  }
  if (action === 'revoke_key') {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!id) throw new Error('API key ID is required.');
    const { error } = await db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('store_id', storeId).is('revoked_at', null);
    if (error) throw error;
    response.status(200).json({ ok: true }); return;
  }
  if (action === 'create_webhook') {
    const url = await validatedWebhookUrl(input.url);
    const choices = ['sale.created', 'stock.low', 'order.online', 'customer.created'];
    const events = Array.isArray(input.events) ? [...new Set(input.events.filter((event): event is string => typeof event === 'string'))] : [];
    if (events.length === 0 || events.some((event) => !choices.includes(event))) throw new Error('Select one or more supported webhook events.');
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    const { data, error } = await db.from('webhooks').insert({ store_id: storeId, url, secret_ciphertext: encryptWebhookSecret(secret), events_json: events, is_active: true, created_by: userId }).select('id,url,events_json,is_active,created_at').single();
    if (error) throw error;
    response.status(201).json({ webhook_secret: secret, webhook: data }); return;
  }
  if (action === 'delete_webhook') {
    const id = typeof input.id === 'string' ? input.id : '';
    const { error } = await db.from('webhooks').delete().eq('id', id).eq('store_id', storeId);
    if (error) throw error;
    response.status(200).json({ ok: true }); return;
  }
  throw new Error('Unknown integrations action.');
}

function decodeBase64Url(value: string): Buffer { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function encodeBase64Url(value: Buffer): string { return value.toString('base64url'); }
function hmac(key: Buffer, data: Buffer): Buffer { return createHmac('sha256', key).update(data).digest(); }
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  let block = Buffer.alloc(0); let output = Buffer.alloc(0); let counter = 1;
  while (output.length < length) {
    block = hmac(prk, Buffer.concat([block, info, Buffer.from([counter])]));
    output = Buffer.concat([output, block]); counter += 1;
  }
  return output.subarray(0, length);
}
function vapidHeader(endpoint: string): string {
  const publicKey = clean(process.env.VAPID_PUBLIC_KEY);
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY);
  const subject = clean(process.env.VAPID_SUBJECT);
  if (!publicKey || !privateKey || !subject) throw new Error('Web Push is not configured on the server. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.');
  const point = decodeBase64Url(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is invalid.');
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = encodeBase64Url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 60 * 60, sub: subject })));
  const unsigned = `${header}.${claims}`;
  const signingKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: encodeBase64Url(point.subarray(1, 33)), y: encodeBase64Url(point.subarray(33, 65)), d: privateKey }, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(unsigned), { key: signingKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${encodeBase64Url(signature)}, k=${publicKey}`;
}
async function sendWebPush(subscription: { endpoint: string; p256dh_key: string; auth_key: string }, payload: Record<string, unknown>): Promise<number> {
  const endpoint = publicUrl(subscription.endpoint);
  const pushHost = new URL(endpoint).hostname.toLowerCase();
  if (pushHost !== 'fcm.googleapis.com' && pushHost !== 'web.push.apple.com' && !pushHost.endsWith('.push.services.mozilla.com') && !pushHost.endsWith('.notify.windows.com')) {
    throw new Error('Push endpoint is not from a supported browser push service.');
  }
  const userPublic = decodeBase64Url(subscription.p256dh_key);
  const authSecret = decodeBase64Url(subscription.auth_key);
  if (userPublic.length !== 65 || authSecret.length < 16) throw new Error('The saved push subscription is invalid.');
  const serverKey = createECDH('prime256v1'); serverKey.generateKeys();
  const serverPublic = serverKey.getPublicKey();
  const shared = serverKey.computeSecret(userPublic);
  const prkKey = hmac(authSecret, shared);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), userPublic, serverPublic]);
  const ikm = hkdfExpand(prkKey, info, 32);
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4); recordSize.writeUInt32BE(4096, 0);
  const body = Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, encrypted]);
  const result = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: vapidHeader(endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400' }, body: body as unknown as BodyInit, signal: AbortSignal.timeout(8000) });
  return result.status;
}
async function notifyUsers(db: SupabaseClient, storeId: string, userIds: string[], type: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  if (!userIds.length) return;
  const eventKey = `${type}:${String(data.notification_key || data.id || randomUUID())}`;
  const rows = userIds.map((userId) => ({ store_id: storeId, user_id: userId, type, title: title.slice(0, 120), body: body.slice(0, 500), data_json: data, event_key: eventKey }));
  const { data: inserted, error } = await db.from('notifications').upsert(rows, { onConflict: 'store_id,user_id,event_key', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  if (!inserted?.length) return;
  const { data: subscriptions, error: subscriptionError } = await db.from('device_push_subscriptions').select('id,endpoint,p256dh_key,auth_key').eq('store_id', storeId).in('user_id', userIds);
  if (subscriptionError) throw subscriptionError;
  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      const status = await sendWebPush(subscription, { title, body, type, data });
      if (status === 404 || status === 410) await db.from('device_push_subscriptions').delete().eq('id', subscription.id);
      else if (status >= 400) console.warn('Web Push provider rejected delivery:', status);
      else await db.from('device_push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', subscription.id);
    } catch (error) { console.warn('Web Push delivery failed:', error instanceof Error ? error.message : 'Unknown error'); }
  }));
}
export async function publishStoreNotification(input: {
  storeId: string;
  type: string;
  title: string;
  body: string;
  eventKey: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const db = database();
  const { data: users, error } = await db.from('users').select('id').eq('store_id', input.storeId).eq('is_active', true);
  if (error) throw error;
  await notifyUsers(db, input.storeId, (users || []).map((user) => String(user.id)), input.type, input.title, input.body, { ...(input.data || {}), id: input.eventKey });
}
async function notificationAction(db: SupabaseClient, action: string, input: Record<string, unknown>, response: ApiResponse): Promise<void> {
  const storeId = typeof input.store_id === 'string' ? input.store_id : '';
  const userId = typeof input.user_id === 'string' ? input.user_id : '';
  if (!storeId || !userId) throw new Error('Store and user IDs are required.');
  await requireStoreUser(db, storeId, userId);
  if (action === 'notification_list') {
    const { data, error } = await db.from('notifications').select('id,type,title,body,data_json,is_read,read_at,created_at').eq('store_id', storeId).eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    response.status(200).json({ notifications: data || [] }); return;
  }
  if (action === 'notification_read') {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string').slice(0, 50) : [];
    if (ids.length) {
      const { error } = await db.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('store_id', storeId).eq('user_id', userId).in('id', ids);
      if (error) throw error;
    }
    response.status(200).json({ ok: true }); return;
  }
  if (action === 'push_subscribe') {
    if (!clean(process.env.VAPID_PUBLIC_KEY) || !clean(process.env.VAPID_PRIVATE_KEY) || !clean(process.env.VAPID_SUBJECT)) throw new Error('Web Push is not configured on the server. Set the VAPID environment variables first.');
    const subscription = bodyObject(input.subscription);
    const endpoint = publicUrl(subscription.endpoint);
    const pushHost = new URL(endpoint).hostname.toLowerCase();
    if (pushHost !== 'fcm.googleapis.com' && pushHost !== 'web.push.apple.com' && !pushHost.endsWith('.push.services.mozilla.com') && !pushHost.endsWith('.notify.windows.com')) throw new Error('Push endpoint is not from a supported browser push service.');
    const keys = bodyObject(subscription.keys);
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new Error('Browser push subscription keys are missing.');
    const { error } = await db.from('device_push_subscriptions').upsert({ store_id: storeId, user_id: userId, endpoint, p256dh_key: keys.p256dh, auth_key: keys.auth, device_label: String(input.device_label || '').slice(0, 120), last_used_at: new Date().toISOString() }, { onConflict: 'endpoint' });
    if (error) throw error;
    response.status(201).json({ ok: true }); return;
  }
  if (action === 'push_unsubscribe') {
    const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '';
    const { error } = await db.from('device_push_subscriptions').delete().eq('store_id', storeId).eq('user_id', userId).eq('endpoint', endpoint);
    if (error) throw error;
    response.status(200).json({ ok: true }); return;
  }
  if (action === 'sync_failed') {
    const { data: users, error } = await db.from('users').select('id').eq('store_id', storeId).eq('is_active', true);
    if (error) throw error;
    const eventKey = `${userId}:${new Date().toISOString().slice(0, 13)}`;
    const detail = 'Cloud sync could not complete on a store device. Check the connection and sync status.';
    await notifyUsers(db, storeId, (users || []).map((user) => String(user.id)), 'sync_failed', 'Sync needs attention', detail, { id: eventKey, page: 'devices' });
    response.status(202).json({ ok: true }); return;
  }
  if (action === 'debt_reminder_due') {
    const count = Math.max(1, Math.min(500, Math.floor(Number(input.count) || 1)));
    const day = new Date().toISOString().slice(0, 10);
    const { data: users, error } = await db.from('users').select('id').eq('store_id', storeId).eq('is_active', true);
    if (error) throw error;
    await notifyUsers(db, storeId, (users || []).map((user) => String(user.id)), 'debt_reminder_due', 'Debt reminders sent', `${count} due customer debt reminder${count === 1 ? '' : 's'} sent by SMS.`, { id: day });
    response.status(202).json({ ok: true }); return;
  }
  throw new Error('Unknown notification action.');
}

function allowedResource(value: string): Resource {
  if (value === 'products' || value === 'customers' || value === 'transactions' || value === 'stores') return value;
  throw new Error('Resource must be products, customers, transactions, or stores.');
}
async function checkRateLimit(db: SupabaseClient, keyId: string): Promise<void> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const { data, error } = await db.rpc('consume_adimat_api_rate_limit', { p_key_id: keyId, p_window_start: windowStart });
  if (error) throw error;
  if (Number(data) > 120) throw Object.assign(new Error('Rate limit exceeded. Try again in one minute.'), { statusCode: 429 });
}
async function publicApi(db: SupabaseClient, request: ApiRequest, response: ApiResponse): Promise<void> {
  const rawKey = one(request.headers['x-api-key']) || one(request.headers.authorization).replace(/^Bearer\s+/i, '');
  if (!/^adm_live_[A-Za-z0-9_-]{40,}$/.test(rawKey)) throw Object.assign(new Error('A valid API key is required.'), { statusCode: 401 });
  const { data: keyRow, error: keyError } = await db.from('api_keys').select('id,store_id,scopes_json').eq('key_hash', hash(rawKey)).is('revoked_at', null).maybeSingle();
  if (keyError) throw keyError;
  if (!keyRow) throw Object.assign(new Error('A valid API key is required.'), { statusCode: 401 });
  await checkRateLimit(db, keyRow.id);
  const url = new URL(request.url || '/', 'https://api.adimat.app');
  const resource = allowedResource(url.searchParams.get('resource') || url.pathname.split('/').filter(Boolean).pop() || '');
  const method = (request.method || 'GET').toUpperCase();
  const write = method !== 'GET';
  if (write && (resource === 'transactions' || resource === 'stores')) throw Object.assign(new Error('This resource is read-only.'), { statusCode: 405 });
  const scope = `${resource}:${write ? 'write' : 'read'}`;
  const scopes = Array.isArray(keyRow.scopes_json) ? keyRow.scopes_json : [];
  if (!scopes.includes(scope) && !(method === 'GET' && scopes.includes(`${resource}:write`))) throw Object.assign(new Error(`This key does not have ${scope} permission.`), { statusCode: 403 });
  const id = url.searchParams.get('id');
  const fields = READ_FIELDS[resource].join(',');
  if (method === 'GET') {
    let query = db.from(resource).select(fields).eq('store_id', keyRow.store_id).limit(Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50)));
    if (id) query = query.eq('id', id);
    const { data, error } = await query;
    if (error) throw error;
    await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);
    response.status(200).json({ data: data || [] }); return;
  }
  if (method === 'DELETE') {
    if (!id) throw new Error('Provide an id query parameter.');
    const { data, error } = await db.from(resource).update({ is_active: false, updated_at: new Date().toISOString() }).eq('store_id', keyRow.store_id).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error('Record not found.'), { statusCode: 404 });
    response.status(200).json({ ok: true }); return;
  }
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') throw Object.assign(new Error('Method not allowed.'), { statusCode: 405 });
  const values = pickAllowed(request.body, WRITE_FIELDS[resource]!);
  if (method === 'POST') {
    if (resource === 'products' && (typeof values.name !== 'string' || !Number.isFinite(Number(values.selling_price)))) throw new Error('Products require name and a valid selling_price.');
    if (resource === 'customers' && typeof values.name !== 'string') throw new Error('Customers require a name.');
    const { data, error } = await db.from(resource).insert({ ...values, id: randomUUID(), store_id: keyRow.store_id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select(fields).single();
    if (error) throw error;
    response.status(201).json({ data }); return;
  }
  if (!id) throw new Error('Provide an id query parameter.');
  const { data, error } = await db.from(resource).update({ ...values, updated_at: new Date().toISOString() }).eq('store_id', keyRow.store_id).eq('id', id).select(fields).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Record not found.'), { statusCode: 404 });
  response.status(200).json({ data });
}

function eventData(event: string, data: Record<string, unknown>, storeId: string): Record<string, unknown> {
  return { id: randomBytes(16).toString('hex'), type: event, store_id: storeId, created_at: new Date().toISOString(), data };
}
async function emitEvent(db: SupabaseClient, input: Record<string, unknown>): Promise<void> {
  const storeId = typeof input.store_id === 'string' ? input.store_id : '';
  const event = typeof input.event === 'string' ? input.event : '';
  const id = typeof input.id === 'string' ? input.id : '';
  let eventId = id;
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId) || !/^[0-9a-f-]{36}$/i.test(id) || !['sale.created', 'stock.low', 'order.online', 'customer.created'].includes(event)) throw new Error('Invalid event reference.');
  let data: Record<string, unknown>;
  if (event === 'sale.created') {
    const { data: sale, error } = await db.from('transactions').select('id,store_id,receipt_number,total_amount,payment_method,status,created_at').eq('store_id', storeId).eq('id', id).maybeSingle();
    if (error) throw error; if (!sale) throw Object.assign(new Error('Sale not found.'), { statusCode: 404 });
    const { data: items, error: itemError } = await db.from('transaction_items').select('product_id,product_name,quantity,unit_price,subtotal').eq('store_id', storeId).eq('transaction_id', id);
    if (itemError) throw itemError;
    data = { ...sale, items: items || [] };
  } else if (event === 'stock.low') {
    const saleId = typeof input.event_id === 'string' ? input.event_id : '';
    if (!/^[0-9a-f-]{36}$/i.test(saleId)) throw new Error('Stock alert needs a valid sale reference.');
    const { data: sale, error: saleError } = await db.from('transactions').select('id,status,void_status').eq('store_id', storeId).eq('id', saleId).maybeSingle();
    if (saleError) throw saleError;
    if (!sale || sale.status !== 'completed' || sale.void_status === 'voided') throw new Error('Stock alert sale reference is invalid.');
    const { data: soldItem, error: itemError } = await db.from('transaction_items').select('id').eq('store_id', storeId).eq('transaction_id', saleId).eq('product_id', id).limit(1).maybeSingle();
    if (itemError) throw itemError;
    if (!soldItem) throw new Error('Stock alert product was not in the referenced sale.');
    eventId = saleId;
    const { data: product, error } = await db.from('products').select('id,store_id,name,stock_level,reorder_level').eq('store_id', storeId).eq('id', id).maybeSingle();
    if (error) throw error; if (!product) throw Object.assign(new Error('Product not found.'), { statusCode: 404 }); data = product;
    if (Number(product.stock_level) > Number(product.reorder_level)) throw new Error('Product is not below its low-stock threshold.');
  } else if (event === 'order.online') {
    const { data: order, error } = await db.from('online_orders').select('id,store_id,order_number,customer_name,total_amount,status,created_at').eq('store_id', storeId).eq('id', id).maybeSingle();
    if (error) throw error; if (!order) throw Object.assign(new Error('Online order not found.'), { statusCode: 404 }); data = order;
  } else if (event === 'customer.created') {
    const { data: customer, error } = await db.from('customers').select('id,store_id,name,phone,created_at').eq('store_id', storeId).eq('id', id).maybeSingle();
    if (error) throw error; if (!customer) throw Object.assign(new Error('Customer not found.'), { statusCode: 404 }); data = customer;
  } else {
    throw Object.assign(new Error('Unsupported event.'), { statusCode: 400 });
  }
  if (event !== 'sale.created') {
    const { data: owners, error: ownersError } = await db.from('users').select('id').eq('store_id', storeId).eq('is_active', true);
    if (ownersError) throw ownersError;
    const notificationType = event === 'stock.low' ? 'low_stock' : event === 'order.online' ? 'online_order' : 'customer_created';
    const title = event === 'stock.low' ? 'Low stock alert' : event === 'order.online' ? 'New online order' : 'New customer';
    const description = event === 'stock.low' ? `${String(data.name)} is at ${String(data.stock_level)} in stock.` : event === 'order.online' ? `Order ${String(data.order_number)} from ${String(data.customer_name)}.` : `${String(data.name)} was added.`;
    await notifyUsers(db, storeId, (owners || []).map((owner) => String(owner.id)), notificationType, title, description, { event, id, notification_key: eventId });
  }
  const { data: hooks, error } = await db.from('webhooks').select('id,url,secret_ciphertext,events_json').eq('store_id', storeId).eq('is_active', true);
  if (error) throw error;
  let sent = 0;
  for (const hook of hooks || []) {
    if (!Array.isArray(hook.events_json) || !hook.events_json.includes(event)) continue;
    const payload = eventData(event, data, storeId);
    const serialized = JSON.stringify(payload);
    const signature = createHmac('sha256', decryptWebhookSecret(String(hook.secret_ciphertext))).update(serialized).digest('hex');
    const deliveryId = randomUUID();
    const { error: insertError } = await db.from('webhook_deliveries').insert({ id: deliveryId, webhook_id: hook.id, store_id: storeId, event, payload_json: payload, event_key: `${event}:${eventId}`, attempts: 1, next_attempt_at: new Date().toISOString() });
    if (insertError && !/duplicate|unique/i.test(insertError.message)) throw insertError;
    if (insertError) continue;
    let status = 0; let result = '';
    try {
      const response = await fetch(await validatedWebhookUrl(hook.url), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-adimat-event': event, 'x-adimat-delivery': deliveryId, 'x-adimat-signature': `sha256=${signature}` }, body: serialized, signal: AbortSignal.timeout(5000) });
      status = response.status; result = (await response.text()).slice(0, 1000);
    } catch (error) { result = error instanceof Error ? error.message.slice(0, 1000) : 'Delivery failed.'; }
    const ok = status >= 200 && status < 300;
    await db.from('webhook_deliveries').update({ attempts: 1, response_status: status || null, response_body: result, last_error: ok ? '' : result || `HTTP ${status}`, delivered_at: ok ? new Date().toISOString() : null, next_attempt_at: ok ? null : new Date(Date.now() + 60_000).toISOString() }).eq('id', deliveryId);
    sent += 1;
  }
  void sent;
}

async function retryWebhookDeliveries(db: SupabaseClient): Promise<number> {
  const now = new Date();
  const { data: due, error } = await db.from('webhook_deliveries').select('id,webhook_id,event,payload_json,attempts').is('delivered_at', null).lte('next_attempt_at', now.toISOString()).lt('attempts', 6).order('next_attempt_at').limit(50);
  if (error) throw error;
  let attempted = 0;
  for (const delivery of due || []) {
    const { data: hook, error: hookError } = await db.from('webhooks').select('url,secret_ciphertext,is_active').eq('id', delivery.webhook_id).maybeSingle();
    if (hookError) throw hookError;
    if (!hook?.is_active) continue;
    const serialized = JSON.stringify(delivery.payload_json);
    const signature = createHmac('sha256', decryptWebhookSecret(String(hook.secret_ciphertext))).update(serialized).digest('hex');
    const nextAttempt = Number(delivery.attempts) + 1;
    let status = 0; let result = '';
    try {
      const response = await fetch(await validatedWebhookUrl(hook.url), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-adimat-event': delivery.event, 'x-adimat-delivery': delivery.id, 'x-adimat-signature': `sha256=${signature}` }, body: serialized, signal: AbortSignal.timeout(5000) });
      status = response.status; result = (await response.text()).slice(0, 1000);
    } catch (error) { result = error instanceof Error ? error.message.slice(0, 1000) : 'Delivery failed.'; }
    const ok = status >= 200 && status < 300;
    const delay = Math.min(60 * 60_000, 60_000 * (2 ** Math.max(0, nextAttempt - 1)));
    await db.from('webhook_deliveries').update({ attempts: nextAttempt, response_status: status || null, response_body: result, last_error: ok ? '' : result || `HTTP ${status}`, delivered_at: ok ? now.toISOString() : null, next_attempt_at: ok || nextAttempt >= 6 ? null : new Date(now.getTime() + delay).toISOString() }).eq('id', delivery.id);
    attempted += 1;
  }
  return attempted;
}

export async function handleIntegrations(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (request.method === 'OPTIONS') { response.status(204).json({}); return; }
  try {
    const db = database();
    const action = one(request.query?.action);
    const input = bodyObject(request.body || {});
    if (action === 'retry-webhooks') {
      const cronSecret = clean(process.env.CRON_SECRET);
      const authorization = one(request.headers.authorization);
      if (!cronSecret || !safeEqual(authorization, `Bearer ${cronSecret}`)) throw Object.assign(new Error('Unauthorized.'), { statusCode: 401 });
      response.status(200).json({ attempted: await retryWebhookDeliveries(db) }); return;
    }
    if (action && request.method !== 'POST') throw Object.assign(new Error('Use POST for integration actions.'), { statusCode: 405 });
    if (action === 'emit') {
      await emitEvent(db, input);
      response.status(202).json({ accepted: true }); return;
    }
    if (action === 'notification_list' || action === 'notification_read' || action === 'push_subscribe' || action === 'push_unsubscribe' || action === 'sync_failed' || action === 'debt_reminder_due') {
      await notificationAction(db, action, input, response); return;
    }
    if (action) { await manage(db, input, response); return; }
    await publicApi(db, request, response);
  } catch (error) {
    const explicitStatus = Number((error as { statusCode?: number })?.statusCode);
    const statusCode = explicitStatus || ((error as { code?: string })?.code ? 500 : 400);
    response.status(statusCode).json({ error: error instanceof Error ? error.message : 'Integration request failed.' });
  }
}

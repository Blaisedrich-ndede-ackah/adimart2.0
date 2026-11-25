import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { isIP } from 'node:net';
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
  send?: (value: string) => void;
}

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
async function requireStoreUser(db: SupabaseClient, storeId: string, userId: string): Promise<void> {
  const { data, error } = await db.from('users').select('id,is_active').eq('id', userId).eq('store_id', storeId).maybeSingle();
  if (error) throw error;
  if (!data || (data.is_active !== true && data.is_active !== 1 && data.is_active !== '1')) throw Object.assign(new Error('The signed-in user is inactive or was not found for this store.'), { statusCode: 403 });
}
async function activeStoreUserIds(db: SupabaseClient, storeId: string): Promise<string[]> {
  const { data, error } = await db.from('users').select('id,is_active').eq('store_id', storeId);
  if (error) throw error;
  return (data || []).filter((user) => user.is_active === true || user.is_active === 1 || user.is_active === '1').map((user) => String(user.id));
}
function publicUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Browser push endpoint is invalid.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname) || url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Browser push endpoint must use a public HTTPS hostname.');
  return url.toString();
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
  await notifyUsers(db, input.storeId, await activeStoreUserIds(db, input.storeId), input.type, input.title, input.body, { ...(input.data || {}), id: input.eventKey });
}
async function notificationAction(db: SupabaseClient, action: string, input: Record<string, unknown>, response: ApiResponse): Promise<void> {
  const storeId = typeof input.store_id === 'string' ? input.store_id : '';
  const userId = typeof input.user_id === 'string' ? input.user_id : '';
  if (!storeId || !userId) throw new Error('Store and user IDs are required.');
  await requireStoreUser(db, storeId, userId);
  if (action === 'notification_list') {
    const [notifications, unread] = await Promise.all([
      db.from('notifications').select('id,type,title,body,data_json,is_read,read_at,created_at').eq('store_id', storeId).eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
      db.from('notifications').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('user_id', userId).eq('is_read', false),
    ]);
    if (notifications.error) throw notifications.error; if (unread.error) throw unread.error;
    response.status(200).json({ notifications: notifications.data || [], unread_count: unread.count || 0 }); return;
  }
  if (action === 'notification_read') {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : [];
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
    const eventKey = `${userId}:${new Date().toISOString().slice(0, 13)}`;
    const detail = 'Cloud sync could not complete on a store device. Check the connection and sync status.';
    await notifyUsers(db, storeId, await activeStoreUserIds(db, storeId), 'sync_failed', 'Sync needs attention', detail, { id: eventKey, page: 'devices' });
    response.status(202).json({ ok: true }); return;
  }
  if (action === 'debt_reminder_due') {
    const count = Math.max(1, Math.min(500, Math.floor(Number(input.count) || 1)));
    const day = new Date().toISOString().slice(0, 10);
    await notifyUsers(db, storeId, await activeStoreUserIds(db, storeId), 'debt_reminder_due', 'Debt reminders sent', `${count} due customer debt reminder${count === 1 ? '' : 's'} sent by SMS.`, { id: day });
    response.status(202).json({ ok: true }); return;
  }
  throw new Error('Unknown notification action.');
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
    const activeUserIds = await activeStoreUserIds(db, storeId);
    const notificationType = event === 'stock.low' ? 'low_stock' : event === 'order.online' ? 'online_order' : 'customer_created';
    const title = event === 'stock.low' ? 'Low stock alert' : event === 'order.online' ? 'New online order' : 'New customer';
    const description = event === 'stock.low' ? `${String(data.name)} is at ${String(data.stock_level)} in stock.` : event === 'order.online' ? `Order ${String(data.order_number)} from ${String(data.customer_name)}.` : `${String(data.name)} was added.`;
    await notifyUsers(db, storeId, activeUserIds, notificationType, title, description, { event, id, notification_key: eventId });
  }

}

export async function handleIntegrations(request: ApiRequest, response: ApiResponse): Promise<void> {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') { response.status(204).json({}); return; }
    const db = database();
    const action = one(request.query?.action);
    const input = bodyObject(request.body || {});
    if (action === 'sitemap') {
      if (request.method !== 'GET') throw Object.assign(new Error('Use GET for the sitemap.'), { statusCode: 405 });
      if (!response.send) throw new Error('Sitemap response is unavailable.');
      const host = one(request.headers['x-forwarded-host']) || one(request.headers.host);
      if (!host || /[\s/\\]/.test(host)) throw new Error('Could not determine the public site address.');
      const forwardedProto = one(request.headers['x-forwarded-proto']);
      const origin = `${forwardedProto === 'http' ? 'http' : 'https'}://${host}`;
      const { data: shops, error } = await db.from('stores').select('ecommerce_slug,updated_at').eq('ecommerce_enabled', true).not('ecommerce_slug', 'is', null).limit(5000);
      if (error) throw error;
      const urls = (shops || []).filter((shop) => typeof shop.ecommerce_slug === 'string' && shop.ecommerce_slug.trim()).map((shop) => {
        const loc = `${origin}/shop/${encodeURIComponent(String(shop.ecommerce_slug).trim())}`;
        const lastmod = shop.updated_at ? `<lastmod>${new Date(shop.updated_at).toISOString()}</lastmod>` : '';
        return `<url><loc>${loc}</loc>${lastmod}</url>`;
      }).join('');
      response.setHeader('Content-Type', 'application/xml; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      response.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`); return;
    }
    if (!action || action === 'manage' || action === 'retry-webhooks') throw Object.assign(new Error('This endpoint is not available.'), { statusCode: 410 });
    const allowedActions = ['sitemap', 'emit', 'notification_list', 'notification_read', 'push_subscribe', 'push_unsubscribe', 'sync_failed', 'debt_reminder_due'];
    if (!allowedActions.includes(action)) throw Object.assign(new Error('Unknown integration action.'), { statusCode: 404 });
    if (action !== 'sitemap' && request.method !== 'POST') throw Object.assign(new Error('Use POST for this action.'), { statusCode: 405 });
    if (action === 'emit') {
      await emitEvent(db, input);
      response.status(202).json({ accepted: true }); return;
    }
    if (action === 'notification_list' || action === 'notification_read' || action === 'push_subscribe' || action === 'push_unsubscribe' || action === 'sync_failed' || action === 'debt_reminder_due') {
      await notificationAction(db, action, input, response); return;
    }
  } catch (error) {
    const explicitStatus = Number((error as { statusCode?: number })?.statusCode);
    const statusCode = explicitStatus || ((error as { code?: string })?.code ? 500 : 400);
    console.error('[integrations] Request failed:', error);
    response.status(statusCode).json({ error: error instanceof Error ? error.message : 'Integration request failed.' });
  }
}

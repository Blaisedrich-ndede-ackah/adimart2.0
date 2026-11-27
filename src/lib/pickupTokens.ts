import { db, generateId, type LocalPickupToken, type LocalPickupVerificationLog, type PickupTokenStatus } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const QR_PREFIX = 'ADIMAT-PICKUP';

export interface PickupToken extends LocalPickupToken {}

export interface PickupTokenValidation {
  valid: boolean;
  token?: PickupToken;
  reason?: 'invalid' | 'expired' | 'alreadyRedeemed';
}

export function buildPickupQrPayload(storeId: string, tokenCode: string): string {
  return `${QR_PREFIX}|${storeId}|${tokenCode}`;
}

export function parsePickupTokenCode(rawValue: string, storeId: string): string {
  const value = rawValue.trim().toUpperCase();
  const prefix = `${QR_PREFIX}|${storeId}|`.toUpperCase();
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

/** Create and save the pickup token directly from the checkout device. */
export async function generatePickupToken(
  storeId: string,
  orderId: string,
  orderNumber: string,
  ttlMinutes: number,
): Promise<PickupToken> {
  if (!storeId || !orderId || !orderNumber) throw new Error('Store and paid pickup order are required.');
  if (!isSupabaseConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    throw new Error('Connect to the internet to create the pickup code. Your payment is recorded; retry when online.');
  }

  const [{ data: order, error: orderError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from('online_orders')
      .select('id, store_id, order_number, total_amount, payment_method, notes')
      .eq('id', orderId).eq('store_id', storeId).maybeSingle(),
    supabase.from('stores')
      .select('pickup_verification_enabled, pickup_token_ttl_minutes')
      .eq('id', storeId).maybeSingle(),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (settingsError) throw new Error(settingsError.message);
  if (!order || order.order_number !== orderNumber || order.payment_method !== 'paystack'
    || !String(order.order_number).startsWith('PS-')
    || !/^price-scan-paystack:[A-Za-z0-9_-]{4,80}$/.test(String(order.notes || ''))) {
    throw new Error('The paid Scan & Pay order has not synced to the store yet. Retry in a moment.');
  }
  if (!settings || settings.pickup_verification_enabled === false) {
    throw new Error('Pickup verification is disabled for this store.');
  }

  const { data: existing, error: existingError } = await supabase.from('pickup_tokens')
    .select('*').eq('store_id', storeId).eq('order_id', orderId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && (existing.status === 'redeemed'
    || (existing.status === 'issued' && Date.parse(existing.expires_at) > Date.now()))) {
    const token: PickupToken = { ...existing, synced: 1 };
    await db.pickup_tokens.put(token);
    return token;
  }

  const configuredTtl = Number(settings.pickup_token_ttl_minutes);
  const fallbackTtl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30;
  const safeTtl = Math.max(5, Math.min(240, Math.floor(Number.isFinite(configuredTtl) ? configuredTtl : fallbackTtl)));
  const issuedAt = new Date();
  const tokenCode = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('');
  const record: Omit<LocalPickupToken, 'synced'> = {
    id: existing?.id || crypto.randomUUID(),
    store_id: storeId,
    order_id: orderId,
    order_number: orderNumber,
    token_code: tokenCode,
    qr_payload: buildPickupQrPayload(storeId, tokenCode),
    status: 'issued',
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + safeTtl * 60_000).toISOString(),
    redeemed_at: null,
    redeemed_by: null,
    redeemed_by_name: null,
    redeemed_method: null,
  };
  const saveResult = existing
    ? await supabase.from('pickup_tokens').update(record).eq('id', existing.id).eq('status', existing.status).select('*').maybeSingle()
    : await supabase.from('pickup_tokens').insert(record).select('*').maybeSingle();
  if (saveResult.error?.code === '23505') {
    const { data: raced, error: racedError } = await supabase.from('pickup_tokens')
      .select('*').eq('store_id', storeId).eq('order_id', orderId).maybeSingle();
    if (racedError) throw new Error(racedError.message);
    if (raced) {
      const token: PickupToken = { ...raced, synced: 1 };
      await db.pickup_tokens.put(token);
      return token;
    }
  }
  if (saveResult.error) throw new Error(saveResult.error.message);
  if (!saveResult.data) {
    const { data: current, error: currentError } = await supabase.from('pickup_tokens')
      .select('*').eq('store_id', storeId).eq('order_id', orderId).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error('The pickup code could not be saved. Run the pickup-verification database migration and retry.');
    const token: PickupToken = { ...current, synced: 1 };
    await db.pickup_tokens.put(token);
    return token;
  }
  const token: PickupToken = { ...saveResult.data, synced: 1 };
  await db.pickup_tokens.put(token);
  return token;
}

export async function validatePickupToken(storeId: string, rawCode: string): Promise<PickupTokenValidation> {
  const code = parsePickupTokenCode(rawCode, storeId);
  if (!storeId || !code) return { valid: false, reason: 'invalid' };
  let token = await db.pickup_tokens
    .where('store_id')
    .equals(storeId)
    .filter((row) => row.token_code.toUpperCase() === code)
    .first();
  if (isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    const { data: remoteToken } = await supabase.from('pickup_tokens').select('*')
      .eq('store_id', storeId).eq('token_code', code).maybeSingle();
    if (remoteToken) {
      token = { ...remoteToken, synced: 1 } as PickupToken;
      await db.pickup_tokens.put(token);
    }
  }
  if (!token) return { valid: false, reason: 'invalid' };
  if (token.status === 'redeemed') return { valid: false, token, reason: 'alreadyRedeemed' };
  if (token.status === 'expired' || Date.parse(token.expires_at) <= Date.now()) {
    if (token.status !== 'expired') await db.pickup_tokens.update(token.id, { status: 'expired', synced: 0 });
    return { valid: false, token: { ...token, status: 'expired' }, reason: 'expired' };
  }
  return token.status === 'issued' ? { valid: true, token } : { valid: false, token, reason: 'invalid' };
}

export async function redeemPickupToken(tokenId: string, redeemedById: string, redeemedByName: string): Promise<void> {
  const token = await db.pickup_tokens.get(tokenId);
  if (!token || token.status !== 'issued' || Date.parse(token.expires_at) <= Date.now()) {
    throw new Error('This pickup token is no longer valid. Scan it again to see its status.');
  }
  const redeemedAt = new Date().toISOString();
  let synced = 0;
  if (isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    const { data, error } = await supabase.from('pickup_tokens').update({
      status: 'redeemed', redeemed_at: redeemedAt, redeemed_by: redeemedById,
      redeemed_by_name: redeemedByName, redeemed_method: 'scan',
    }).eq('id', token.id).eq('store_id', token.store_id).eq('status', 'issued')
      .gt('expires_at', redeemedAt).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('This pickup code was already used or expired.');
    synced = 1;
  }
  await db.transaction('rw', [db.pickup_tokens, db.pickup_verification_logs], async () => {
    await db.pickup_tokens.update(token.id, {
      status: 'redeemed',
      redeemed_at: redeemedAt,
      redeemed_by: redeemedById,
      redeemed_by_name: redeemedByName,
      redeemed_method: 'scan',
      synced,
    });
    await db.pickup_verification_logs.add({
      id: generateId(),
      store_id: token.store_id,
      token_id: token.id,
      order_id: token.order_id,
      order_number: token.order_number,
      scanned_code: token.token_code,
      event_type: 'redeemed',
      verified_by: redeemedById,
      verified_by_name: redeemedByName,
      created_at: redeemedAt,
      synced: 0,
    });
  });
  void syncPickupTokens(token.store_id).catch(() => undefined);
}

/** Make any issued Scan & Pay pass unusable when an order is completed at the pickup desk. */
export async function redeemPickupTokenForOrder(
  orderId: string,
  redeemedById: string,
  redeemedByName: string,
): Promise<void> {
  let token = await db.pickup_tokens.where('order_id').equals(orderId).first();
  if (isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    const { data, error } = await supabase.from('pickup_tokens').select('*').eq('order_id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    token = { ...data, synced: 1 } as PickupToken;
    await db.pickup_tokens.put(token);
  }
  if (!token || token.status !== 'issued') return;
  await redeemPickupToken(token.id, redeemedById, redeemedByName);
}

export async function recordPickupOverride(
  storeId: string,
  rawCode: string,
  ownerId: string,
  ownerName: string,
  details: string,
): Promise<void> {
  const code = parsePickupTokenCode(rawCode, storeId);
  const token = code
    ? await db.pickup_tokens.where('store_id').equals(storeId).filter((row) => row.token_code.toUpperCase() === code).first()
    : undefined;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.pickup_tokens, db.pickup_verification_logs], async () => {
    if (token) {
      await db.pickup_tokens.update(token.id, {
        status: 'redeemed',
        redeemed_at: now,
        redeemed_by: ownerId,
        redeemed_by_name: ownerName,
        redeemed_method: 'override',
        synced: 0,
      });
    }
    await db.pickup_verification_logs.add({
      id: generateId(),
      store_id: storeId,
      token_id: token?.id || null,
      order_id: token?.order_id || null,
      order_number: token?.order_number || '',
      scanned_code: code,
      event_type: 'override',
      verified_by: ownerId,
      verified_by_name: ownerName,
      details: details.trim(),
      created_at: now,
      synced: 0,
    });
  });
  void syncPickupTokens(storeId).catch(() => undefined);
}

export async function getUnredeemedTokens(storeId: string): Promise<PickupToken[]> {
  await expireOldTokens(storeId);
  return db.pickup_tokens.where('store_id').equals(storeId)
    .filter((token) => token.status === 'issued')
    .toArray();
}

export async function expireOldTokens(storeId: string): Promise<void> {
  if (!storeId) return;
  const now = new Date().toISOString();
  await db.pickup_tokens.where('store_id').equals(storeId)
    .filter((token) => token.status === 'issued' && token.expires_at <= now)
    .modify({ status: 'expired', synced: 0 });
}

export async function getTodayPickupVerifications(storeId: string): Promise<LocalPickupVerificationLog[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.pickup_verification_logs.where('store_id').equals(storeId)
    .filter((entry) => entry.created_at >= start.toISOString())
    .toArray();
}

/** Push pending redemptions and warm this device's local cache for offline checks. */
export async function syncPickupTokens(storeId: string): Promise<void> {
  if (!storeId || !isSupabaseConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const unsyncedTokens = await db.pickup_tokens.where('store_id').equals(storeId)
    .filter((token) => token.synced === 0)
    .toArray();
  for (const token of unsyncedTokens) {
    const { error } = await supabase.from('pickup_tokens').update({
      status: token.status,
      redeemed_at: token.redeemed_at,
      redeemed_by: token.redeemed_by,
      redeemed_by_name: token.redeemed_by_name,
      redeemed_method: token.redeemed_method || 'scan',
    }).eq('id', token.id).eq('store_id', storeId);
    if (!error) await db.pickup_tokens.update(token.id, { synced: 1 });
  }

  const unsyncedLogs = await db.pickup_verification_logs.where('store_id').equals(storeId)
    .filter((entry) => entry.synced === 0)
    .toArray();
  if (unsyncedLogs.length) {
    for (const entry of unsyncedLogs) {
      const { error } = await supabase.from('pickup_verification_logs').insert({
        id: entry.id,
        store_id: entry.store_id,
        token_id: entry.token_id,
        order_id: entry.order_id,
        order_number: entry.order_number,
        scanned_code: entry.scanned_code,
        event_type: entry.event_type,
        verified_by: entry.verified_by,
        verified_by_name: entry.verified_by_name,
        details: entry.details || '',
        created_at: entry.created_at,
      });
      if (!error || error.code === '23505') {
        await db.pickup_verification_logs.update(entry.id, { synced: 1 });
      }
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: tokens, error: tokenError } = await supabase.from('pickup_tokens').select('*')
    .eq('store_id', storeId).gte('issued_at', today.toISOString());
  if (!tokenError && tokens) {
    for (const row of tokens as LocalPickupToken[]) {
      const local = await db.pickup_tokens.get(row.id);
      if (!local || local.synced !== 0) await db.pickup_tokens.put({ ...row, synced: 1 });
    }
  }
  const { data: logs, error: logError } = await supabase.from('pickup_verification_logs').select('*')
    .eq('store_id', storeId).gte('created_at', today.toISOString());
  if (!logError && logs) {
    for (const row of logs as LocalPickupVerificationLog[]) {
      const local = await db.pickup_verification_logs.get(row.id);
      if (!local || local.synced !== 0) await db.pickup_verification_logs.put({ ...row, synced: 1 });
    }
  }
}

export function pickupTokenStatusLabel(status: PickupTokenStatus): string {
  return status === 'issued' ? 'issued' : status === 'redeemed' ? 'redeemed' : 'expired';
}

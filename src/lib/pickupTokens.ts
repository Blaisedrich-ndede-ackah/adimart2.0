import { db, generateId, type LocalPickupToken, type LocalPickupVerificationLog, type PickupTokenStatus } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const QR_PREFIX = 'ADIMAT-PICKUP';

export interface PickupToken extends LocalPickupToken {}

export interface PickupTokenValidation {
  valid: boolean;
  token?: PickupToken;
  reason?: 'invalid' | 'expired' | 'alreadyRedeemed';
}

interface PickupTokenApiResponse {
  pickupToken?: LocalPickupToken;
  error?: string;
}

export function buildPickupQrPayload(storeId: string, tokenCode: string): string {
  return `${QR_PREFIX}|${storeId}|${tokenCode}`;
}

export function parsePickupTokenCode(rawValue: string, storeId: string): string {
  const value = rawValue.trim().toUpperCase();
  const prefix = `${QR_PREFIX}|${storeId}|`.toUpperCase();
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

/** Ask the server to verify the Paystack charge and issue an idempotent token. */
export async function generatePickupToken(
  storeId: string,
  orderId: string,
  orderNumber: string,
  ttlMinutes: number,
): Promise<PickupToken> {
  if (!storeId || !orderId || !orderNumber) throw new Error('Store and paid pickup order are required.');
  const response = await fetch('/api/price-scan-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'issue-pickup-token', storeId, orderId, ttlMinutes }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('The pickup token service returned an invalid response.');
  }
  const result = payload as PickupTokenApiResponse;
  if (!response.ok || !result.pickupToken) {
    throw new Error(result.error || 'Could not issue a verified pickup token.');
  }
  const token: PickupToken = { ...result.pickupToken, synced: 1 };
  await db.pickup_tokens.put(token);
  return token;
}

export async function validatePickupToken(storeId: string, rawCode: string): Promise<PickupTokenValidation> {
  const code = parsePickupTokenCode(rawCode, storeId);
  if (!storeId || !code) return { valid: false, reason: 'invalid' };
  const token = await db.pickup_tokens
    .where('store_id')
    .equals(storeId)
    .filter((row) => row.token_code.toUpperCase() === code)
    .first();
  if (!token) return { valid: false, reason: 'invalid' };
  if (token.status === 'redeemed') return { valid: false, token, reason: 'alreadyRedeemed' };
  if (token.status === 'expired' || Date.parse(token.expires_at) <= Date.now()) {
    if (token.status !== 'expired') await db.pickup_tokens.update(token.id, { status: 'expired', synced: 0 });
    return { valid: false, token: { ...token, status: 'expired' }, reason: 'expired' };
  }
  return token.status === 'issued' ? { valid: true, token } : { valid: false, token, reason: 'invalid' };
}

export async function redeemPickupToken(tokenId: string, redeemedById: string, redeemedByName: string): Promise<void> {
  await db.transaction('rw', [db.pickup_tokens, db.pickup_verification_logs], async () => {
    const token = await db.pickup_tokens.get(tokenId);
    if (!token || token.status !== 'issued' || Date.parse(token.expires_at) <= Date.now()) {
      throw new Error('This pickup token is no longer valid. Scan it again to see its status.');
    }
    const redeemedAt = new Date().toISOString();
    await db.pickup_tokens.update(token.id, {
      status: 'redeemed',
      redeemed_at: redeemedAt,
      redeemed_by: redeemedById,
      redeemed_by_name: redeemedByName,
      redeemed_method: 'scan',
      synced: 0,
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
  void syncPickupTokens((await db.pickup_tokens.get(tokenId))?.store_id || '').catch(() => undefined);
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

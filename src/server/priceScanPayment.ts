import { createClient } from '@supabase/supabase-js';
import { randomInt, randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from './shop';

function cleanEnv(value: string | undefined): string {
  return (value || '').trim().replace(/^['"]+|['"]+$/g, '');
}

function reply(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

function requestText(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function securePickupCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export async function handlePriceScanPaymentVerification(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });

  const action = requestText(req.body, 'action');
  const storeId = requestText(req.body, 'storeId');
  const orderId = requestText(req.body, 'orderId');
  if (!storeId || !orderId) return reply(res, 400, { error: 'Store and order are required.' });

  const projectUrl = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const paystackSecret = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!projectUrl || !serviceKey || !paystackSecret) {
    return reply(res, 503, { error: 'Payment verification is not configured on this server.' });
  }

  try {
    const supabase = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error } = await supabase
      .from('online_orders')
      .select('id, store_id, order_number, total_amount, payment_method, notes')
      .eq('id', orderId)
      .eq('store_id', storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order || !String(order.order_number || '').startsWith('PS-') || order.payment_method !== 'paystack') {
      return reply(res, 404, { error: 'No online-paid pickup order was found.' });
    }

    const referenceMatch = /^price-scan-paystack:([A-Za-z0-9_-]{4,80})$/.exec(String(order.notes || ''));
    if (!referenceMatch) return reply(res, 409, { error: 'This order has no payment reference to verify.' });
    const { data: sameReferenceOrders, error: duplicateError } = await supabase
      .from('online_orders')
      .select('id')
      .eq('store_id', storeId)
      .eq('notes', `price-scan-paystack:${referenceMatch[1]}`);
    if (duplicateError) throw new Error(duplicateError.message);
    if (!sameReferenceOrders || sameReferenceOrders.length !== 1 || sameReferenceOrders[0].id !== orderId) {
      return reply(res, 409, { error: 'This payment reference is linked to more than one order.' });
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(referenceMatch[1])}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verifyPayload = await verifyResponse.json() as {
      status?: boolean;
      message?: string;
      data?: { reference?: string; amount?: number; currency?: string; status?: string };
    };
    if (!verifyResponse.ok || !verifyPayload.status || !verifyPayload.data) {
      return reply(res, 502, { error: verifyPayload.message || 'Could not verify the online payment.' });
    }

    const charge = verifyPayload.data;
    const expectedPesewas = Math.round((Number(order.total_amount) || 0) * 100);
    const verified = charge.status === 'success'
      && charge.currency === 'GHS'
      && charge.reference === referenceMatch[1]
      && Number(charge.amount) === expectedPesewas;
    if (!verified || action !== 'issue-pickup-token') return reply(res, 200, { verified });

    const { data: storeSettings, error: settingsError } = await supabase
      .from('stores')
      .select('pickup_verification_enabled, pickup_token_ttl_minutes')
      .eq('id', storeId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    if (!storeSettings || storeSettings.pickup_verification_enabled === false) {
      return reply(res, 409, { error: 'Exit verification is disabled for this store.' });
    }

    const { data: existingToken, error: existingError } = await supabase
      .from('pickup_tokens')
      .select('*')
      .eq('store_id', storeId)
      .eq('order_id', orderId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existingToken && (
      existingToken.status === 'redeemed'
      || (existingToken.status === 'issued' && Date.parse(existingToken.expires_at) > Date.now())
    )) {
      return reply(res, 200, { verified: true, pickupToken: existingToken });
    }

    const ttlInput = Number(storeSettings.pickup_token_ttl_minutes);
    const ttlMinutes = Math.max(5, Math.min(240, Math.floor(Number.isFinite(ttlInput) ? ttlInput : 30)));
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60_000);
    const tokenCode = securePickupCode();
    const pickupToken = {
      id: existingToken?.id || randomUUID(),
      store_id: storeId,
      order_id: orderId,
      order_number: String(order.order_number),
      token_code: tokenCode,
      qr_payload: `ADIMAT-PICKUP|${storeId}|${tokenCode}`,
      status: 'issued',
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      redeemed_at: null,
      redeemed_by: null,
      redeemed_by_name: null,
      redeemed_method: null,
    };
    const { data: savedToken, error: saveError } = await supabase
      .from('pickup_tokens')
      .upsert(pickupToken, { onConflict: 'id' })
      .select('*')
      .single();
    if (saveError || !savedToken) throw new Error(saveError?.message || 'Could not save the pickup token.');
    return reply(res, 200, { verified: true, pickupToken: savedToken });
  } catch (error: unknown) {
    return reply(res, 500, { error: error instanceof Error ? error.message : 'Payment verification failed.' });
  }
}

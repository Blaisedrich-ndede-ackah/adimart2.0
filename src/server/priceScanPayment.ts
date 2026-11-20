import { createClient } from '@supabase/supabase-js';
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

export async function handlePriceScanPaymentVerification(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });

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
    return reply(res, 200, { verified });
  } catch (error: unknown) {
    return reply(res, 500, { error: error instanceof Error ? error.message : 'Payment verification failed.' });
  }
}

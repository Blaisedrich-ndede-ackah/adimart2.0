import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  url?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

const SMS_UNIT_PESEWAS = 4;
const SMS_SEGMENT_LENGTH = 160;

function smsSegmentCount(message: string): number {
  const length = message.trim().length;
  if (length <= 0) return 0;
  return Math.ceil(length / SMS_SEGMENT_LENGTH);
}

const MOBILE_PREFIXES = ['20', '23', '24', '25', '26', '27', '28', '50', '53', '54', '55', '56', '57', '59'];

function parseGhanaPhone(input: string): { e164: string; digits: string } | null {
  const digits = input.replace(/\D/g, '');
  let national = '';
  if (digits.startsWith('233') && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;
  if (!/^\d{9}$/.test(national)) return null;
  if (!MOBILE_PREFIXES.some((prefix) => national.startsWith(prefix))) return null;
  return { e164: `+233${national}`, digits: national };
}

const TOPUP_MIN_PESEWAS = 100;
const TOPUP_MAX_PESEWAS = 500_000;
const MAX_MESSAGE = 460;
const MAX_RECIPIENTS = 1000;
const SQL_HINT = 'Run supabase-migrate-sms-wallet.sql in the Supabase SQL editor, then try again.';

function cleanEnv(value: string | undefined): string {
  return (value || '').trim().replace(/^["']+|["']+$/g, '');
}

function header(req: ApiRequest, name: string): string {
  const value = req.headers[name.toLowerCase()] ?? req.headers[name];
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error('A JSON object is required.');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function projectUrl(): string {
  const raw = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

function service(): SupabaseClient {
  const url = projectUrl();
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL on the server. Do not prefix the service role key with VITE_.');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function originOf(req: ApiRequest): string {
  const proto = header(req, 'x-forwarded-proto') || 'https';
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return '';
  return `${proto}://${host}`;
}

function missingSchema(message: string): boolean {
  return /adimat_apply_sms_wallet|sms_balance_pesewas|receipt_sms_enabled|sms_topup_intents|sms_wallet_entries|schema cache|does not exist/i.test(message);
}

function normalizeRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of list) {
    const parsed = parseGhanaPhone(String(value || ''));
    if (!parsed || seen.has(parsed.e164)) continue;
    seen.add(parsed.e164);
    out.push(`233${parsed.digits}`);
  }
  return out.slice(0, MAX_RECIPIENTS);
}

async function requireStaff(storeId: string, userId: string, ownerOnly: boolean): Promise<void> {
  if (!storeId || !userId) throw new Error('Store staff sign-in is required.');
  const { data, error } = await service()
    .from('users')
    .select('id, role, is_active, store_id')
    .eq('id', userId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.is_active === false) throw new Error('Store staff sign-in is required.');
  if (ownerOnly && data.role !== 'owner') throw new Error('Only the store owner can change SMS credit.');
  if (data.role !== 'owner' && data.role !== 'cashier') throw new Error('Store staff sign-in is required.');
}

async function applyWallet(
  storeId: string,
  delta: number,
  entryType: string,
  direction: string,
  reference: string,
  recipients: number,
  message: string,
): Promise<number> {
  const { data, error } = await service().rpc('adimat_apply_sms_wallet', {
    p_store_id: storeId,
    p_delta: delta,
    p_entry_type: entryType,
    p_direction: direction,
    p_reference: reference,
    p_recipients: recipients,
    p_message: message,
  });
  if (error) {
    if (/not on the server/i.test(error.message)) throw new Error('This store is not on the server yet.');
    if (/too low/i.test(error.message)) {
      throw new Error('SMS credit is too low. Add credit on the owner dashboard before sending this text.');
    }
    if (missingSchema(error.message)) throw new Error(SQL_HINT);
    throw new Error(error.message);
  }
  return Number(data) || 0;
}

async function readWallet(storeId: string): Promise<{ balancePesewas: number; receiptSmsEnabled: boolean; entries: Record<string, unknown>[] }> {
  const { data, error } = await service()
    .from('stores')
    .select('sms_balance_pesewas, receipt_sms_enabled')
    .eq('id', storeId)
    .maybeSingle();
  if (error) {
    if (missingSchema(error.message)) throw new Error(SQL_HINT);
    throw new Error(error.message);
  }
  if (!data) throw new Error('This store is not on the server yet.');
  const { data: rows, error: entryError } = await service()
    .from('sms_wallet_entries')
    .select('id, entry_type, direction, amount_pesewas, balance_after, recipients, message, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(8);
  if (entryError && !missingSchema(entryError.message)) throw new Error(entryError.message);
  return {
    balancePesewas: Math.max(0, Number(data.sms_balance_pesewas) || 0),
    receiptSmsEnabled: data.receipt_sms_enabled === true,
    entries: (rows || []).map((row) => ({
      id: row.id,
      entryType: row.entry_type,
      direction: row.direction,
      amountPesewas: row.amount_pesewas,
      balanceAfter: row.balance_after,
      recipients: row.recipients,
      message: row.message,
      createdAt: row.created_at,
    })),
  };
}

async function paystackInitialize(input: {
  email: string;
  pesewas: number;
  reference: string;
  callbackUrl: string;
}): Promise<string> {
  const secret = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      amount: input.pesewas,
      currency: 'GHS',
      reference: input.reference,
      channels: ['card', 'mobile_money', 'bank'],
      callback_url: input.callbackUrl,
      metadata: { purpose: 'sms_topup', reference: input.reference },
    }),
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: { authorization_url?: string } };
  if (!response.ok || !payload.status || !payload.data?.authorization_url) {
    throw new Error(payload.message || 'Paystack could not start the payment.');
  }
  return payload.data.authorization_url;
}

async function paystackVerify(reference: string): Promise<{ amount: number; currency: string; status: string }> {
  const secret = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await response.json() as {
    status?: boolean;
    message?: string;
    data?: { amount?: number; currency?: string; status?: string };
  };
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || 'Paystack could not verify this payment.');
  }
  return {
    amount: Number(payload.data.amount) || 0,
    currency: String(payload.data.currency || ''),
    status: String(payload.data.status || ''),
  };
}

export async function settleSmsTopup(charge: {
  reference: string;
  amount: number;
  currency: string;
  status: string;
}): Promise<number> {
  if (!charge.reference.startsWith('SMS-')) throw new Error('This payment is not an SMS top-up.');
  if (charge.status !== 'success') throw new Error('Paystack has not confirmed this payment yet.');
  if (charge.currency && charge.currency !== 'GHS') throw new Error('SMS credit is charged in Ghana cedis.');
  const { data, error } = await service()
    .from('sms_topup_intents')
    .select('store_id, amount_pesewas, reference')
    .eq('reference', charge.reference)
    .maybeSingle();
  if (error) {
    if (missingSchema(error.message)) throw new Error(SQL_HINT);
    throw new Error(error.message);
  }
  if (!data) throw new Error('This SMS payment is not on file.');
  if (Number(data.amount_pesewas) !== charge.amount) throw new Error('The paid amount does not match this SMS top-up.');
  const balance = await applyWallet(
    String(data.store_id),
    charge.amount,
    'topup',
    'credit',
    charge.reference,
    0,
    'Paystack SMS credit',
  );
  await service()
    .from('sms_topup_intents')
    .update({ status: 'paid', verified_at: new Date().toISOString() })
    .eq('reference', charge.reference);
  return balance;
}

async function mnotifyConfig(): Promise<{ key: string; sender: string }> {
  let key = cleanEnv(process.env.MNOTIFY_API_KEY || process.env.VITE_MNOTIFY_API_KEY);
  let sender = cleanEnv(process.env.MNOTIFY_SENDER_ID || process.env.VITE_MNOTIFY_SENDER_ID) || 'Adimat';
  const { data } = await service()
    .from('platform_settings')
    .select('mnotify_api_key, mnotify_sender_id')
    .eq('id', 'main')
    .maybeSingle();
  if (data?.mnotify_api_key) key = String(data.mnotify_api_key).trim();
  if (data?.mnotify_sender_id) sender = String(data.mnotify_sender_id).trim();
  return { key, sender: sender.slice(0, 11) || 'Adimat' };
}

async function sendViaMnotify(recipients: string[], message: string): Promise<void> {
  const { key, sender } = await mnotifyConfig();
  if (!key) throw new Error('mNotify is not configured on the server.');
  const response = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: recipients,
      sender,
      message,
      is_schedule: false,
      schedule_date: '',
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    status?: string;
    code?: string | number;
    message?: string;
    summary?: { message_id?: string };
  };
  const ok = response.ok && (
    body.status === 'success' ||
    body.status === 'ok' ||
    body.code === '2000' ||
    body.code === 2000 ||
    Boolean(body.summary?.message_id)
  );
  if (!ok) throw new Error(body.message || 'mNotify could not send this text.');
}

async function dispatchStoreSms(input: {
  storeId: string;
  kind: string;
  recipients: string[];
  message: string;
}): Promise<{ balancePesewas: number; sentCount: number }> {
  const message = input.message.trim().slice(0, MAX_MESSAGE);
  if (!message) throw new Error('Write a message before sending.');
  if (input.recipients.length === 0) throw new Error('No customer phone number to text.');
  if (input.kind === 'receipt') {
    const wallet = await readWallet(input.storeId);
    if (!wallet.receiptSmsEnabled) throw new Error('Receipt texts are turned off for this store.');
  }
  const cost = smsSegmentCount(message) * input.recipients.length * SMS_UNIT_PESEWAS;
  const balance = await applyWallet(input.storeId, -cost, input.kind, 'debit', '', input.recipients.length, message);
  try {
    await sendViaMnotify(input.recipients, message);
  } catch (error) {
    try {
      await applyWallet(input.storeId, cost, 'refund', 'credit', '', input.recipients.length, 'SMS was not sent');
    } catch {
      // The text was not sent. Keep the original send error for the store.
    }
    throw error;
  }
  return { balancePesewas: balance, sentCount: input.recipients.length };
}

async function handleSmsWallet(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const body = objectBody(req.body);
    const action = text(body.action, 40);
    const storeId = text(body.storeId, 80);
    const userId = text(body.userId, 80);
    if (action === 'balance') {
      await requireStaff(storeId, userId, false);
      return json(res, 200, await readWallet(storeId));
    }
    if (action === 'set-receipt-sms') {
      await requireStaff(storeId, userId, true);
      const enabled = body.enabled === true;
      const { error } = await service().from('stores').update({ receipt_sms_enabled: enabled }).eq('id', storeId);
      if (error) {
        if (missingSchema(error.message)) throw new Error(SQL_HINT);
        throw new Error(error.message);
      }
      return json(res, 200, await readWallet(storeId));
    }
    if (action === 'start-topup') {
      await requireStaff(storeId, userId, true);
      const pesewas = Math.round(Number(body.amount) * 100);
      if (!Number.isFinite(pesewas) || pesewas < TOPUP_MIN_PESEWAS || pesewas > TOPUP_MAX_PESEWAS) {
        throw new Error('Add between GHS 1 and GHS 5,000.');
      }
      const reference = `SMS-${randomBytes(8).toString('hex')}`;
      const { error } = await service().from('sms_topup_intents').insert({
        id: crypto.randomUUID(),
        store_id: storeId,
        reference,
        amount_pesewas: pesewas,
        status: 'pending',
      });
      if (error) {
        if (missingSchema(error.message)) throw new Error(SQL_HINT);
        throw new Error(error.message);
      }
      const origin = originOf(req);
      const authorizationUrl = await paystackInitialize({
        email: `sms+${reference.slice(-12)}@adimatpos.com`,
        pesewas,
        reference,
        callbackUrl: `${origin}/?smsWallet=1`,
      });
      return json(res, 200, { authorizationUrl, reference });
    }
    if (action === 'verify-topup') {
      await requireStaff(storeId, userId, true);
      const reference = text(body.reference, 80);
      const charge = await paystackVerify(reference);
      await settleSmsTopup({ reference, ...charge });
      return json(res, 200, await readWallet(storeId));
    }
    if (action === 'send') {
      await requireStaff(storeId, userId, false);
      const kind = text(body.kind, 20);
      if (!['bulk', 'debt', 'receipt', 'care'].includes(kind)) throw new Error('This SMS is not a store message.');
      const sent = await dispatchStoreSms({
        storeId,
        kind,
        recipients: normalizeRecipients(body.recipients),
        message: text(body.message, MAX_MESSAGE),
      });
      return json(res, 200, { ...sent, failedCount: 0, recipientCount: sent.sentCount });
    }
    throw new Error('Unknown SMS wallet action.');
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'The SMS wallet could not be reached.' });
  }
}

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handleSmsWallet(req, res);
}

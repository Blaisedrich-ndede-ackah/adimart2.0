/**
 * Send a goods payment from the Paystack balance to the store's saved MoMo number.
 * Kept free of app imports so the live function can start on its own.
 */

function clean(value) {
  return String(value || '').trim().replace(/^["']+|["']+$/g, '');
}

function json(res, status, body) {
  res.status(status).json(body);
}

function supabaseConfig() {
  const raw = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!raw || !key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL on the server.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return { url: `${parsed.origin}${path}`, key };
}

async function rest(path, options = {}) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error || text || 'Supabase request failed.';
    throw new Error(message);
  }
  return body;
}

function momoCode(network) {
  const value = String(network || '').toLowerCase();
  if (value.includes('mtn')) return 'MTN';
  if (value.includes('vod') || value.includes('telecel')) return 'VOD';
  if (value.includes('airtel') || value.includes('tigo') || value === 'atl') return 'ATL';
  return '';
}

function momoAccount(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return '';
}

async function paystack(path, body) {
  const secret = clean(process.env.PAYSTACK_SECRET_KEY);
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.status === false) {
    throw new Error(payload.message || 'Paystack could not send this MoMo payout.');
  }
  return payload.data;
}

export async function sendStoreMomoPayout(body, options = {}) {
  try {
    const storeId = String(body.storeId || '').trim();
    const userId = String(body.userId || '').trim();
    const reference = String(body.reference || '').trim().slice(0, 80);
    const amountPesewas = Math.round(Number(body.amountPesewas));
    const description = String(body.description || 'Goods payment').replace(/[\r\n]/g, ' ').slice(0, 80);
    if (!storeId || !reference || (!options.trusted && !userId)) throw new Error('Store, staff, and Paystack reference are required.');
    if (!Number.isFinite(amountPesewas) || amountPesewas < 100) throw new Error('The goods payment is too small to send to MoMo.');

    if (!options.trusted) {
      const staff = await rest(`users?id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,role,is_active&limit=1`);
      const person = Array.isArray(staff) ? staff[0] : null;
      if (!person || person.is_active === false) throw new Error('Store staff sign-in is required.');
    }

    const payoutReference = `MOMO-${reference}`.slice(0, 100);
    const existing = await rest(`store_momo_payouts?reference=eq.${encodeURIComponent(payoutReference)}&select=status,paystack_transfer_code&limit=1`).catch(() => []);
    const prior = Array.isArray(existing) ? existing[0] : null;
    if (prior && (prior.status === 'sent' || prior.status === 'success')) {
      return { ok: true, alreadySent: true, transferCode: prior.paystack_transfer_code || '' };
    }

    const stores = await rest(`stores?id=eq.${encodeURIComponent(storeId)}&select=name,momo_account_name,momo_number,momo_network&limit=1`);
    const store = Array.isArray(stores) ? stores[0] : null;
    if (!store) throw new Error('This store is not on the server yet.');
    const account = momoAccount(store.momo_number);
    const code = momoCode(store.momo_network);
    if (!account || !code) {
      throw new Error('Set this store’s MoMo number and network (MTN, Vodafone, or AirtelTigo) before goods payments can be sent there.');
    }

    const recipient = await paystack('/transferrecipient', {
      type: 'mobile_money',
      name: String(store.momo_account_name || store.name || 'Store').slice(0, 80),
      account_number: account,
      bank_code: code,
      currency: 'GHS',
    });
    const transfer = await paystack('/transfer', {
      source: 'balance',
      amount: amountPesewas,
      recipient: recipient.recipient_code,
      reason: description || 'Goods payment',
      reference: payoutReference,
      currency: 'GHS',
    });

    await rest('store_momo_payouts', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({
        store_id: storeId,
        reference: payoutReference,
        amount_pesewas: amountPesewas,
        momo_number: account,
        status: 'sent',
        paystack_transfer_code: transfer.transfer_code || '',
        error_message: '',
      }),
    }).catch(() => undefined);

    return { ok: true, transferCode: transfer.transfer_code || '' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not send the MoMo payout.' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const result = await sendStoreMomoPayout(body);
  return json(res, result.ok ? 200 : 400, result);
}

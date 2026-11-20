/**
 * Send a goods payment from the Paystack balance to the store's saved MoMo number.
 */

export interface StoreMomoPayoutRequest {
  storeId?: string;
  userId?: string;
  reference?: string;
  amountPesewas?: number;
  description?: string;
}

export interface StoreMomoPayoutResult {
  ok: boolean;
  error?: string;
  message?: string;
  transferCode?: string;
  alreadySent?: boolean;
  status?: string;
  amountGhs?: number;
}

function clean(value: unknown): string {
  return String(value || '').trim().replace(/^["']+|["']+$/g, '');
}

function supabaseConfig(): { url: string; key: string } {
  const raw = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!raw || !key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL on the server.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return { url: `${parsed.origin}${path}`, key };
}

async function rest(path: string, options: { method?: string; body?: string; prefer?: string } = {}): Promise<unknown> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    body: options.body,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as { message?: string; error?: string } : null;
  if (!response.ok) {
    throw new Error(body?.message || body?.error || text || 'Supabase request failed.');
  }
  return body;
}

function momoCode(network: string): string {
  const value = network.toLowerCase();
  if (value.includes('mtn')) return 'MTN';
  if (value.includes('vod') || value.includes('telecel')) return 'VOD';
  if (value.includes('airtel') || value.includes('tigo') || value === 'atl') return 'ATL';
  return '';
}

function momoAccount(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return '';
}

async function paystack(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const secret = clean(process.env.PAYSTACK_SECRET_KEY);
  if (!secret) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.');
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: Record<string, unknown> };
  if (!response.ok || payload.status === false || !payload.data) {
    throw new Error(payload.message || 'Paystack could not send this MoMo payout.');
  }
  return payload.data;
}

export async function sendStoreMomoPayout(
  body: StoreMomoPayoutRequest,
  options: { trusted?: boolean } = {},
): Promise<StoreMomoPayoutResult> {
  try {
    const storeId = String(body.storeId || '').trim();
    const userId = String(body.userId || '').trim();
    const reference = String(body.reference || '').trim().slice(0, 80);
    const amountPesewas = Math.round(Number(body.amountPesewas));
    const description = String(body.description || 'Goods payment').replace(/[\r\n]/g, ' ').slice(0, 80);
    if (!storeId || !reference || (!options.trusted && !userId)) {
      throw new Error('Store, staff, and Paystack reference are required.');
    }
    if (!Number.isFinite(amountPesewas) || amountPesewas < 100) {
      throw new Error('The goods payment is too small to send to MoMo.');
    }

    if (!options.trusted) {
      const staff = await rest(`users?id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,role,is_active&limit=1`);
      const person = Array.isArray(staff) ? staff[0] as { is_active?: boolean } : null;
      if (!person || person.is_active === false) throw new Error('Store staff sign-in is required.');
    }

    const payoutReference = `MOMO-${reference}`.slice(0, 100);
    const existing = await rest(`store_momo_payouts?reference=eq.${encodeURIComponent(payoutReference)}&select=status,paystack_transfer_code&limit=1`).catch(() => []);
    const prior = Array.isArray(existing) ? existing[0] as { status?: string; paystack_transfer_code?: string } : null;
    if (prior && (prior.status === 'sent' || prior.status === 'success')) {
      return { ok: true, alreadySent: true, transferCode: prior.paystack_transfer_code || '' };
    }

    const stores = await rest(`stores?id=eq.${encodeURIComponent(storeId)}&select=name,momo_account_name,momo_number,momo_network&limit=1`);
    const store = Array.isArray(stores) ? stores[0] as { name?: string; momo_account_name?: string; momo_number?: string; momo_network?: string } : null;
    if (!store) throw new Error('This store is not on the server yet.');
    const account = momoAccount(String(store.momo_number || ''));
    const code = momoCode(String(store.momo_network || ''));
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
        paystack_transfer_code: String(transfer.transfer_code || ''),
        error_message: '',
      }),
    }).catch(() => undefined);

    return { ok: true, transferCode: String(transfer.transfer_code || '') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not send the MoMo payout.' };
  }
}

interface StoredPayout {
  status?: string;
  paystack_transfer_code?: string;
  amount_pesewas?: number;
  error_message?: string;
}

function payoutReferenceFor(reference: string): string {
  return `MOMO-${reference}`.slice(0, 100);
}

async function readPayout(reference: string): Promise<StoredPayout | null> {
  const rows = await rest(
    `store_momo_payouts?reference=eq.${encodeURIComponent(payoutReferenceFor(reference))}&select=status,paystack_transfer_code,amount_pesewas,error_message&limit=1`
  ).catch(() => []);
  return Array.isArray(rows) ? (rows[0] as StoredPayout | undefined) || null : null;
}

async function writePayoutStatus(reference: string, status: string, errorMessage: string): Promise<void> {
  await rest(`store_momo_payouts?reference=eq.${encodeURIComponent(payoutReferenceFor(reference))}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({ status, error_message: errorMessage.slice(0, 240) }),
  });
}

function moneyFromPesewas(pesewas: number): string {
  return (Math.round(pesewas) / 100).toFixed(2);
}

/**
 * A sent MoMo transfer cannot be pulled back by Paystack. Flag it so the
 * store can return the amount, then mark that return as settled.
 */
export async function undoStoreMomoPayout(
  body: StoreMomoPayoutRequest,
  options: { trusted?: boolean } = {},
): Promise<StoreMomoPayoutResult> {
  try {
    const storeId = String(body.storeId || '').trim();
    const userId = String(body.userId || '').trim();
    const reference = String(body.reference || '').trim().slice(0, 80);
    if (!storeId || !reference || (!options.trusted && !userId)) {
      throw new Error('Store, staff, and Paystack reference are required.');
    }
    if (!options.trusted) {
      const staff = await rest(`users?id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,is_active&limit=1`);
      const person = Array.isArray(staff) ? staff[0] as { is_active?: boolean } : null;
      if (!person || person.is_active === false) throw new Error('Store staff sign-in is required.');
    }

    const prior = await readPayout(reference);
    if (!prior) {
      return { ok: true, status: 'none', message: 'No goods MoMo payout was sent for this payment.' };
    }
    const amountGhs = (Number(prior.amount_pesewas) || 0) / 100;
    if (prior.status === 'reversed') {
      return { ok: true, status: 'reversed', amountGhs, message: 'This MoMo payout is already marked returned.' };
    }
    if (prior.status === 'reversal_due') {
      return {
        ok: true,
        status: 'reversal_due',
        amountGhs,
        message: prior.error_message || `GH₵ ${moneyFromPesewas(Number(prior.amount_pesewas) || 0)} is still on the store MoMo. Return it, then mark it returned.`,
      };
    }

    let transferStatus = '';
    try {
      const transfer = await paystack(`/transfer/verify/${encodeURIComponent(payoutReferenceFor(reference))}`);
      transferStatus = String(transfer.status || '').toLowerCase();
    } catch {
      transferStatus = '';
    }
    if (transferStatus === 'failed' || transferStatus === 'reversed' || transferStatus === 'abandoned') {
      await writePayoutStatus(reference, 'reversed', 'Paystack did not complete this MoMo payout.');
      return { ok: true, status: 'reversed', amountGhs, message: 'Paystack did not complete this MoMo payout, so nothing has to be returned.' };
    }

    const message = `GH₵ ${moneyFromPesewas(Number(prior.amount_pesewas) || 0)} was sent to the store MoMo. Paystack cannot pull a sent transfer back. Return that amount, then mark it returned.`;
    await writePayoutStatus(reference, 'reversal_due', message);
    return { ok: true, status: 'reversal_due', amountGhs, message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not undo the MoMo payout.' };
  }
}

export async function settleStoreMomoReversal(
  body: StoreMomoPayoutRequest,
  options: { trusted?: boolean } = {},
): Promise<StoreMomoPayoutResult> {
  try {
    const storeId = String(body.storeId || '').trim();
    const userId = String(body.userId || '').trim();
    const reference = String(body.reference || '').trim().slice(0, 80);
    if (!storeId || !reference || (!options.trusted && !userId)) {
      throw new Error('Store, staff, and Paystack reference are required.');
    }
    if (!options.trusted) {
      const staff = await rest(`users?id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,role,is_active&limit=1`);
      const person = Array.isArray(staff) ? staff[0] as { role?: string; is_active?: boolean } : null;
      if (!person || person.is_active === false || person.role !== 'owner') {
        throw new Error('Only the store owner can mark a MoMo payout returned.');
      }
    }
    const prior = await readPayout(reference);
    if (!prior) return { ok: false, error: 'No goods MoMo payout was sent for this payment.' };
    if (prior.status === 'reversed') {
      return { ok: true, status: 'reversed', message: 'This MoMo payout is already marked returned.' };
    }
    await writePayoutStatus(reference, 'reversed', 'The store returned this MoMo payout.');
    return { ok: true, status: 'reversed', amountGhs: (Number(prior.amount_pesewas) || 0) / 100, message: 'The MoMo payout is marked returned.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not mark the MoMo payout returned.' };
  }
}

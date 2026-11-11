/**
 * Store SMS units live on the store row in Supabase, the same place the rest
 * of the shop already syncs. Texts are debited there before mNotify is called.
 * The owner dashboard reads that balance directly, so the wallet still loads
 * when the separate SMS API route is down.
 */

import { db } from '@/lib/dexie';
import { sendBulkSmsViaMnotify, sendSmsViaMnotify } from '@/lib/mnotify';
import { initializePaystack, resolvePaystackEmail } from '@/lib/paystack';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { smsCostPesewas } from './smsPricing';

export {
  SMS_SEGMENT_LENGTH,
  SMS_TOPUP_PRESETS_GHS,
  SMS_UNIT_PESEWAS,
  canAffordSms,
  smsCostPesewas,
  smsSegmentCount,
  textsRemaining,
} from './smsPricing';

export type StoreSmsKind = 'bulk' | 'debt' | 'receipt' | 'closing';

export interface SmsWalletEntry {
  id: string;
  entryType: string;
  direction: string;
  amountPesewas: number;
  balanceAfter: number;
  recipients: number;
  message: string;
  createdAt: string;
}

export interface SmsWalletSnapshot {
  balancePesewas: number;
  entries: SmsWalletEntry[];
}

const SETUP_HINT = 'SMS units are not on the server yet. Run supabase-migrate-sms-wallet.sql in the Supabase SQL editor.';

function walletError(error: { message?: string } | null, fallback: string): Error {
  const message = error?.message || fallback;
  if (/sms_balance_pesewas|sms_wallet_entries|sms_topup_intents|schema cache|does not exist/i.test(message)) {
    return new Error(SETUP_HINT);
  }
  if (/too low/i.test(message)) {
    return new Error('SMS credit is too low. Add credit on the owner dashboard before sending this text.');
  }
  return new Error(message);
}

function retryableMessage(message: string): boolean {
  return /failed to fetch|networkerror|network request failed|offline|load failed|timeout/i.test(message);
}

async function remember(storeId: string, balancePesewas: number): Promise<void> {
  await db.stores.update(storeId, { sms_balance_pesewas: balancePesewas });
  const store = await db.stores.get(storeId);
  if (store && useAuthStore.getState().currentStore?.id === storeId) {
    useAuthStore.setState({ currentStore: store });
  }
}

async function readEntries(storeId: string): Promise<SmsWalletEntry[]> {
  const { data, error } = await supabase
    .from('sms_wallet_entries')
    .select('id, entry_type, direction, amount_pesewas, balance_after, recipients, message, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) {
    if (/does not exist|schema cache|permission denied|42501/i.test(error.message)) return [];
    throw walletError(error, 'SMS credit could not be read.');
  }
  return (data || []).map((row) => ({
    id: String(row.id || ''),
    entryType: String(row.entry_type || ''),
    direction: String(row.direction || ''),
    amountPesewas: Number(row.amount_pesewas) || 0,
    balanceAfter: Number(row.balance_after) || 0,
    recipients: Number(row.recipients) || 0,
    message: String(row.message || ''),
    createdAt: String(row.created_at || ''),
  }));
}

async function writeEntry(input: {
  storeId: string;
  entryType: string;
  direction: string;
  amountPesewas: number;
  balanceAfter: number;
  recipients: number;
  message: string;
  reference?: string;
}): Promise<void> {
  const { error } = await supabase.from('sms_wallet_entries').insert({
    id: crypto.randomUUID(),
    store_id: input.storeId,
    entry_type: input.entryType,
    direction: input.direction,
    amount_pesewas: input.amountPesewas,
    balance_after: input.balanceAfter,
    recipients: input.recipients,
    message: input.message.slice(0, 460),
    reference: input.reference || null,
  });
  if (error && !/does not exist|schema cache|duplicate|23505|permission denied|42501/i.test(error.message)) {
    throw walletError(error, 'SMS credit could not be recorded.');
  }
}

async function changeBalance(
  storeId: string,
  delta: number,
  entryType: string,
  direction: string,
  recipients: number,
  message: string,
  reference = '',
): Promise<number> {
  if (!isSupabaseConfigured()) throw new Error('Cloud sync is not configured for this app.');
  if (reference) {
    const existing = await supabase
      .from('sms_wallet_entries')
      .select('balance_after')
      .eq('reference', reference)
      .eq('entry_type', 'topup')
      .maybeSingle();
    if (!existing.error && existing.data) return Number(existing.data.balance_after) || 0;
  }

  const rpc = await supabase.rpc('adimat_apply_sms_wallet', {
    p_store_id: storeId,
    p_delta: delta,
    p_entry_type: entryType,
    p_direction: direction,
    p_reference: reference,
    p_recipients: recipients,
    p_message: message,
  });
  if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
    const balance = Number(rpc.data) || 0;
    await remember(storeId, balance);
    return balance;
  }
  if (rpc.error && !/permission denied|42501|could not find the function|schema cache|does not exist/i.test(rpc.error.message)) {
    throw walletError(rpc.error, 'SMS credit could not be updated.');
  }

  const current = await supabase.from('stores').select('sms_balance_pesewas').eq('id', storeId).maybeSingle();
  if (current.error) throw walletError(current.error, 'SMS credit could not be read.');
  if (!current.data) throw new Error('This store is not on the server yet.');
  const balance = Math.max(0, Number(current.data.sms_balance_pesewas) || 0);
  const next = balance + delta;
  if (next < 0) throw new Error('SMS credit is too low. Add credit on the owner dashboard before sending this text.');
  const updated = await supabase
    .from('stores')
    .update({ sms_balance_pesewas: next })
    .eq('id', storeId)
    .eq('sms_balance_pesewas', balance)
    .select('sms_balance_pesewas')
    .maybeSingle();
  if (updated.error) throw walletError(updated.error, 'SMS credit could not be updated.');
  if (!updated.data) throw new Error('SMS credit changed while this text was sending. Try again.');
  const saved = Number(updated.data.sms_balance_pesewas) || 0;
  await writeEntry({
    storeId,
    entryType,
    direction,
    amountPesewas: Math.abs(delta),
    balanceAfter: saved,
    recipients,
    message,
    reference,
  });
  await remember(storeId, saved);
  return saved;
}

export async function loadSmsWallet(storeId: string, _userId?: string): Promise<SmsWalletSnapshot> {
  if (!isSupabaseConfigured()) throw new Error('Cloud sync is not configured for this app.');
  const { data, error } = await supabase.from('stores').select('sms_balance_pesewas').eq('id', storeId).maybeSingle();
  if (error) throw walletError(error, 'SMS credit could not be read.');
  if (!data) throw new Error('This store is not on the server yet.');
  const balancePesewas = Math.max(0, Number(data.sms_balance_pesewas) || 0);
  const entries = await readEntries(storeId);
  await remember(storeId, balancePesewas);
  return { balancePesewas, entries };
}

export function paySmsTopup(storeId: string, amountGhs: number): Promise<SmsWalletSnapshot> {
  const pesewas = Math.round(Number(amountGhs) * 100);
  if (!Number.isFinite(pesewas) || pesewas < 100 || pesewas > 500_000) {
    return Promise.reject(new Error('Add between GHS 1 and GHS 5,000.'));
  }
  const reference = `SMS-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    void initializePaystack({
      email: resolvePaystackEmail(undefined, reference),
      amount: pesewas,
      reference,
      paymentFor: 'SMS credit',
      metadata: { purpose: 'sms_topup', storeId },
      onClose: () => reject(new Error('SMS payment was cancelled.')),
      onSuccess: () => {
        void changeBalance(storeId, pesewas, 'topup', 'credit', 0, 'Paystack SMS credit', reference)
          .then(async (balancePesewas) => resolve({ balancePesewas, entries: await readEntries(storeId) }))
          .catch(reject);
      },
    }).catch(reject);
  });
}

export interface StoreSmsSendResult {
  ok: boolean;
  error?: string;
  sentCount: number;
  failedCount: number;
  recipientCount: number;
  balancePesewas?: number;
  retryable: boolean;
}

export async function sendStoreSms(input: {
  storeId: string;
  userId?: string;
  kind: StoreSmsKind;
  recipients: string[];
  message: string;
}): Promise<StoreSmsSendResult> {
  const recipients = input.recipients.map((phone) => phone.trim()).filter(Boolean);
  const message = input.message.trim();
  if (recipients.length === 0) {
    return { ok: false, error: 'No phone number to text.', sentCount: 0, failedCount: 0, recipientCount: 0, retryable: false };
  }
  if (!message) {
    return { ok: false, error: 'Write a message before sending.', sentCount: 0, failedCount: recipients.length, recipientCount: recipients.length, retryable: false };
  }
  const cost = smsCostPesewas(message, recipients.length);
  let balancePesewas: number | undefined;
  try {
    balancePesewas = await changeBalance(
      input.storeId,
      -cost,
      input.kind,
      'debit',
      recipients.length,
      message,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : 'SMS credit could not be used.';
    return {
      ok: false,
      error: text,
      sentCount: 0,
      failedCount: recipients.length,
      recipientCount: recipients.length,
      retryable: retryableMessage(text),
    };
  }

  const sent = recipients.length === 1
    ? await sendSmsViaMnotify(recipients[0], message)
    : await sendBulkSmsViaMnotify(recipients, message);
  const sentCount = 'sentCount' in sent ? sent.sentCount : (sent.success ? 1 : 0);
  if (sent.success && sentCount > 0) {
    return {
      ok: true,
      sentCount,
      failedCount: 'failedCount' in sent ? sent.failedCount : 0,
      recipientCount: recipients.length,
      balancePesewas,
      retryable: false,
    };
  }

  const unused = smsCostPesewas(message, Math.max(0, recipients.length - sentCount));
  if (unused > 0) {
    try {
      balancePesewas = await changeBalance(input.storeId, unused, 'refund', 'credit', recipients.length - sentCount, 'SMS was not sent');
    } catch {
      // The text was not sent. Keep the send error for the cashier.
    }
  }
  const error = sent.error || 'Could not send the text.';
  return {
    ok: false,
    error,
    sentCount,
    failedCount: recipients.length - sentCount,
    recipientCount: recipients.length,
    balancePesewas,
    retryable: retryableMessage(error),
  };
}

/**
 * Store SMS units. Paystack credit on the server is the only way a store
 * pays for its own texts. Receipts, closing summaries, debt reminders, and
 * bulk messages all debit this store before mNotify is called.
 */

import { db } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';

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

async function remember(storeId: string, balancePesewas: number): Promise<void> {
  await db.stores.update(storeId, { sms_balance_pesewas: balancePesewas });
  const store = await db.stores.get(storeId);
  if (store && useAuthStore.getState().currentStore?.id === storeId) {
    useAuthStore.setState({ currentStore: store });
  }
}

async function postSmsWallet(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/api/sms-wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!response.ok) {
    throw new Error(payload.error || 'The SMS wallet could not be reached.');
  }
  return payload;
}

function snapshotFrom(payload: Record<string, unknown>): SmsWalletSnapshot {
  if (typeof payload.balancePesewas !== 'number') {
    throw new Error('The SMS wallet could not be reached.');
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return {
    balancePesewas: Number(payload.balancePesewas) || 0,
    entries: entries.map((row) => {
      const entry = row as Record<string, unknown>;
      return {
        id: String(entry.id || ''),
        entryType: String(entry.entryType || ''),
        direction: String(entry.direction || ''),
        amountPesewas: Number(entry.amountPesewas) || 0,
        balanceAfter: Number(entry.balanceAfter) || 0,
        recipients: Number(entry.recipients) || 0,
        message: String(entry.message || ''),
        createdAt: String(entry.createdAt || ''),
      };
    }),
  };
}

export async function loadSmsWallet(storeId: string, userId: string): Promise<SmsWalletSnapshot> {
  const payload = await postSmsWallet({ action: 'balance', storeId, userId });
  const snapshot = snapshotFrom(payload);
  await remember(storeId, snapshot.balancePesewas);
  return snapshot;
}

export async function startSmsTopup(storeId: string, userId: string, amountGhs: number): Promise<string> {
  const payload = await postSmsWallet({ action: 'start-topup', storeId, userId, amount: amountGhs });
  const url = String(payload.authorizationUrl || '');
  if (!url) throw new Error('Paystack did not open a payment page.');
  return url;
}

export async function verifySmsTopup(storeId: string, userId: string, reference: string): Promise<SmsWalletSnapshot> {
  const payload = await postSmsWallet({ action: 'verify-topup', storeId, userId, reference });
  const snapshot = snapshotFrom(payload);
  await remember(storeId, snapshot.balancePesewas);
  return snapshot;
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
  const userId = input.userId || useAuthStore.getState().currentUser?.id || '';
  const recipients = input.recipients.map((phone) => phone.trim()).filter(Boolean);
  if (!userId) {
    return { ok: false, error: 'Sign in again before sending texts.', sentCount: 0, failedCount: recipients.length, recipientCount: recipients.length, retryable: false };
  }
  if (recipients.length === 0) {
    return { ok: false, error: 'No phone number to text.', sentCount: 0, failedCount: 0, recipientCount: 0, retryable: false };
  }
  try {
    const payload = await postSmsWallet({
      action: 'send',
      storeId: input.storeId,
      userId,
      kind: input.kind,
      recipients,
      message: input.message,
    });
    const balance = Number(payload.balancePesewas);
    if (Number.isFinite(balance)) await remember(input.storeId, balance);
    const sentCount = Number(payload.sentCount) || 0;
    return {
      ok: sentCount > 0,
      error: payload.error ? String(payload.error) : undefined,
      sentCount,
      failedCount: Number(payload.failedCount) || 0,
      recipientCount: Number(payload.recipientCount) || recipients.length,
      balancePesewas: Number.isFinite(balance) ? balance : undefined,
      retryable: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not send the text.';
    const retryable = /could not be reached|failed to fetch|network|offline|load failed/i.test(message);
    return {
      ok: false,
      error: message,
      sentCount: 0,
      failedCount: recipients.length,
      recipientCount: recipients.length,
      retryable,
    };
  }
}

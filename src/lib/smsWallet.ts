/**
 * Store SMS wallet. Paystack credit on the server is the only way a store
 * pays for its own texts: bulk messages, debt reminders, care replies, and
 * receipt texts.
 */

import { db } from '@/lib/dexie';
import { normalizeGhanaPhone } from '@/lib/platformSettings';
import { useAuthStore } from '@/store/useAuthStore';
import {
  customerPhoneOnFile,
  receiptSmsMessage,
} from './smsPricing';

export {
  SMS_SEGMENT_LENGTH,
  SMS_TOPUP_PRESETS_GHS,
  SMS_UNIT_PESEWAS,
  canAffordSms,
  customerPhoneOnFile,
  receiptSmsMessage,
  smsCostPesewas,
  smsSegmentCount,
  textsRemaining,
} from './smsPricing';

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
  receiptSmsEnabled: boolean;
  entries: SmsWalletEntry[];
}

async function remember(storeId: string, snapshot: SmsWalletSnapshot): Promise<void> {
  await db.stores.update(storeId, {
    sms_balance_pesewas: snapshot.balancePesewas,
    receipt_sms_enabled: snapshot.receiptSmsEnabled ? 1 : 0,
  });
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
    receiptSmsEnabled: payload.receiptSmsEnabled === true,
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
  await remember(storeId, snapshot);
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
  await remember(storeId, snapshot);
  return snapshot;
}

export async function setReceiptSmsEnabled(storeId: string, userId: string, enabled: boolean): Promise<SmsWalletSnapshot> {
  const previous = (await db.stores.get(storeId))?.receipt_sms_enabled ?? 0;
  await db.stores.update(storeId, { receipt_sms_enabled: enabled ? 1 : 0, synced: 0 });
  try {
    const payload = await postSmsWallet({ action: 'set-receipt-sms', storeId, userId, enabled });
    const snapshot = snapshotFrom(payload);
    await remember(storeId, snapshot);
    return snapshot;
  } catch (error) {
    await db.stores.update(storeId, { receipt_sms_enabled: previous });
    const store = await db.stores.get(storeId);
    if (store && useAuthStore.getState().currentStore?.id === storeId) {
      useAuthStore.setState({ currentStore: store });
    }
    throw error;
  }
}

export interface StoreSmsSendResult {
  ok: boolean;
  error?: string;
  sentCount: number;
  failedCount: number;
  recipientCount: number;
  balancePesewas?: number;
}

export async function sendStoreSms(input: {
  storeId: string;
  userId?: string;
  kind: 'bulk' | 'debt' | 'receipt' | 'care';
  recipients: string[];
  message: string;
}): Promise<StoreSmsSendResult> {
  const userId = input.userId || useAuthStore.getState().currentUser?.id || '';
  const recipients = input.recipients.map((phone) => phone.trim()).filter(Boolean);
  if (!userId) {
    return { ok: false, error: 'Sign in again before sending texts.', sentCount: 0, failedCount: recipients.length, recipientCount: recipients.length };
  }
  if (recipients.length === 0) {
    return { ok: false, error: 'No customer phone number to text.', sentCount: 0, failedCount: 0, recipientCount: 0 };
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
    if (Number.isFinite(balance)) {
      const store = await db.stores.get(input.storeId);
      await remember(input.storeId, {
        balancePesewas: balance,
        receiptSmsEnabled: (store?.receipt_sms_enabled ?? 0) === 1,
        entries: [],
      });
    }
    const sentCount = Number(payload.sentCount) || 0;
    return {
      ok: sentCount > 0,
      error: payload.error ? String(payload.error) : undefined,
      sentCount,
      failedCount: Number(payload.failedCount) || 0,
      recipientCount: Number(payload.recipientCount) || recipients.length,
      balancePesewas: Number.isFinite(balance) ? balance : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not send the text.',
      sentCount: 0,
      failedCount: recipients.length,
      recipientCount: recipients.length,
    };
  }
}

/** Text a receipt only when that phone already belongs to a customer of this store. */
export async function sendReceiptSmsIfCustomerOnFile(input: {
  storeId: string;
  userId: string;
  customerId?: string | null;
  phone?: string;
  storeName: string;
  receiptNumber: string;
  totalLabel: string;
  balanceLabel?: string;
}): Promise<string> {
  const store = await db.stores.get(input.storeId);
  if ((store?.receipt_sms_enabled ?? 0) !== 1) return '';
  let customer = input.customerId ? await db.customers.get(input.customerId) : null;
  if (!customerPhoneOnFile(customer, input.storeId) && input.phone) {
    const wanted = normalizeGhanaPhone(input.phone);
    if (wanted) {
      const rows = await db.customers.where('store_id').equals(input.storeId).toArray();
      customer = rows.find((row) => row.is_active === 1 && normalizeGhanaPhone(String(row.phone || '')) === wanted) ?? null;
    }
  }
  if (!customerPhoneOnFile(customer, input.storeId)) return '';
  const phone = String(customer?.phone || '');
  const result = await sendStoreSms({
    storeId: input.storeId,
    userId: input.userId,
    kind: 'receipt',
    recipients: [phone],
    message: receiptSmsMessage({
      storeName: input.storeName,
      receiptNumber: input.receiptNumber,
      totalLabel: input.totalLabel,
      balanceLabel: input.balanceLabel,
    }),
  });
  if (result.ok) return 'Receipt text sent.';
  return result.error ? `Receipt text was not sent. ${result.error}` : 'Receipt text was not sent.';
}

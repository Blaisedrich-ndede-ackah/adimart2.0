/**
 * mNotify BMS SMS client (https://api.mnotify.com).
 * API key + sender ID come from platform_settings (admin-configured).
 */

import { loadPlatformSettings, normalizeGhanaPhone } from './platformSettings';
import { formatSubscriptionDate } from './subscription';

const MNOTIFY_QUICK_SMS_URL = 'https://api.mnotify.com/api/sms/quick';

/** mNotify quick SMS accepts an array of recipients. We cap the batch so
 * a single store can never submit an unbounded list in one request. */
const BULK_SMS_MAX_RECIPIENTS = 1000;

export interface SendSmsResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

/** Result of a single bulk send attempt. */
export interface BulkSmsResult {
  success: boolean;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: 'sent' | 'failed' | 'partial';
  error?: string;
  providerMessageId?: string;
}

function envFallbackApiKey(): string {
  return (import.meta.env.VITE_MNOTIFY_API_KEY || '').trim();
}

function envFallbackSender(): string {
  return (import.meta.env.VITE_MNOTIFY_SENDER_ID || 'Adimat').trim().slice(0, 11) || 'Adimat';
}

/** Deduplicate and normalize a list of raw phone numbers. */
export function normalizeRecipientList(rawPhones: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawPhones || []) {
    const normalized = normalizeGhanaPhone(String(raw || ''));
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Send one message to many recipients in a single mNotify quick SMS call.
 * mNotify accepts an array of recipients; we still cap the batch so a
 * misbehaving store can never spam the network in one request.
 */
export async function sendBulkSmsViaMnotify(
  recipients: string[],
  message: string
): Promise<BulkSmsResult> {
  const settings = await loadPlatformSettings();
  const apiKey = settings.mnotify_api_key || envFallbackApiKey();
  const sender = settings.mnotify_sender_id || envFallbackSender();
  const normalized = normalizeRecipientList(recipients);

  if (!apiKey) {
    return {
      success: false,
      recipientCount: normalized.length,
      sentCount: 0,
      failedCount: normalized.length,
      status: 'failed',
      error: 'mNotify API key not configured',
    };
  }
  if (normalized.length === 0) {
    return {
      success: false,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'failed',
      error: 'No customer phone numbers to send to',
    };
  }
  if (!message.trim()) {
    return {
      success: false,
      recipientCount: normalized.length,
      sentCount: 0,
      failedCount: normalized.length,
      status: 'failed',
      error: 'Message is empty',
    };
  }

  const batch = normalized.slice(0, BULK_SMS_MAX_RECIPIENTS);

  try {
    const url = `${MNOTIFY_QUICK_SMS_URL}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: batch,
        sender,
        message: message.trim(),
        is_schedule: false,
        schedule_date: '',
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      status?: string | number;
      code?: string | number;
      message?: string;
      summary?: { message_id?: string };
    };

    const ok =
      res.ok &&
      (body.status === 'success' ||
        body.status === 'ok' ||
        body.code === '2000' ||
        body.code === 2000 ||
        Boolean(body.summary?.message_id));

    if (!ok) {
      return {
        success: false,
        recipientCount: batch.length,
        sentCount: 0,
        failedCount: batch.length,
        status: 'failed',
        error: body.message || `mNotify request failed (${res.status})`,
        providerMessageId: body.summary?.message_id,
      };
    }

    return {
      success: true,
      recipientCount: batch.length,
      sentCount: batch.length,
      failedCount: 0,
      status: 'sent',
      providerMessageId: body.summary?.message_id,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      recipientCount: batch.length,
      sentCount: 0,
      failedCount: batch.length,
      status: 'failed',
      error: msg,
    };
  }
}

/**
 * Send an SMS via mNotify quick SMS API.
 * Soft-fails when API key / recipient is missing so UI flows are not blocked.
 */
export async function sendSmsViaMnotify(
  recipientRaw: string,
  message: string
): Promise<SendSmsResult> {
  const result = await sendBulkSmsViaMnotify([recipientRaw], message);
  if (result.error === 'No customer phone numbers to send to') {
    return { success: false, skipped: true, error: 'No recipient phone number' };
  }
  if (result.error === 'mNotify API key not configured') {
    return { success: false, skipped: true, error: 'mNotify API key not configured' };
  }
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

function smsDedupeKey(kind: 'activated' | 'expiring', storeId: string, expiresAt: string): string {
  return `adimat_sms_${kind}_${storeId}_${expiresAt}`;
}

function alreadySent(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSent(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ignore quota / private mode
  }
}

/** Prefer store support phone, then MoMo number. */
export function resolveStoreOwnerPhone(store: {
  support_number?: string;
  momo_number?: string;
}): string {
  return (store.support_number || store.momo_number || '').trim();
}

/**
 * SMS store owner when admin activates / renews their subscription.
 */
export async function notifySubscriptionActivated(opts: {
  storeId: string;
  storeName: string;
  ownerPhone: string;
  months: number;
  expiresAt: string;
}): Promise<SendSmsResult> {
  const key = smsDedupeKey('activated', opts.storeId, opts.expiresAt);
  if (alreadySent(key)) {
    return { success: true, skipped: true };
  }

  const message =
    `Adimat POS: Subscription activated for ${opts.storeName}. ` +
    `${opts.months} month${opts.months === 1 ? '' : 's'} granted. ` +
    `Expires ${formatSubscriptionDate(opts.expiresAt)}. Thank you.`;

  const result = await sendSmsViaMnotify(opts.ownerPhone, message);
  if (result.success) markSent(key);
  return result;
}

/**
 * SMS store owner when subscription is within the warning window.
 * Deduped per store + expiry date so it only sends once per period.
 */
export async function notifySubscriptionExpiringSoon(opts: {
  storeId: string;
  storeName: string;
  ownerPhone: string;
  expiresAt: string;
  daysLeft: number;
}): Promise<SendSmsResult> {
  const key = smsDedupeKey('expiring', opts.storeId, opts.expiresAt);
  if (alreadySent(key)) {
    return { success: true, skipped: true };
  }

  const message =
    `Adimat POS: Your subscription for ${opts.storeName} expires ` +
    `${opts.daysLeft <= 0 ? 'today' : `in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`} ` +
    `(${formatSubscriptionDate(opts.expiresAt)}). ` +
    `Open the Plan tab and pay with Paystack to renew instantly.`;

  const result = await sendSmsViaMnotify(opts.ownerPhone, message);
  if (result.success) markSent(key);
  return result;
}

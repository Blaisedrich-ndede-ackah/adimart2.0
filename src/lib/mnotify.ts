/**
 * mNotify BMS SMS client (https://api.mnotify.com).
 * API key + sender ID come from platform_settings (admin-configured).
 */

import { loadPlatformSettings, normalizeGhanaPhone } from './platformSettings';
import { formatSubscriptionDate } from './subscription';

const MNOTIFY_QUICK_SMS_URL = 'https://api.mnotify.com/api/sms/quick';

export interface SendSmsResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

function envFallbackApiKey(): string {
  return (import.meta.env.VITE_MNOTIFY_API_KEY || '').trim();
}

function envFallbackSender(): string {
  return (import.meta.env.VITE_MNOTIFY_SENDER_ID || 'Adimat').trim().slice(0, 11) || 'Adimat';
}

/**
 * Send an SMS via mNotify quick SMS API.
 * Soft-fails when API key / recipient is missing so UI flows are not blocked.
 */
export async function sendSmsViaMnotify(
  recipientRaw: string,
  message: string
): Promise<SendSmsResult> {
  const settings = await loadPlatformSettings();
  const apiKey = settings.mnotify_api_key || envFallbackApiKey();
  const sender = settings.mnotify_sender_id || envFallbackSender();
  const recipient = normalizeGhanaPhone(recipientRaw);

  if (!apiKey) {
    return { success: false, skipped: true, error: 'mNotify API key not configured' };
  }
  if (!recipient) {
    return { success: false, skipped: true, error: 'No recipient phone number' };
  }
  if (!message.trim()) {
    return { success: false, error: 'Message is empty' };
  }

  try {
    const url = `${MNOTIFY_QUICK_SMS_URL}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: [recipient],
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
        error: body.message || `mNotify request failed (${res.status})`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
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
    `Open the Plan tab to contact the administrator and renew.`;

  const result = await sendSmsViaMnotify(opts.ownerPhone, message);
  if (result.success) markSent(key);
  return result;
}

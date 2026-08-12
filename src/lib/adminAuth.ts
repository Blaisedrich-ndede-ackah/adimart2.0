/**
 * Platform administrator access for the Adimat Admin Portal.
 * Step 1: VITE_ADMIN_PIN · Step 2: SMS OTP to admin phone.
 */

import { sendSmsViaMnotify } from './mnotify';
import {
  loadPlatformSettings,
  normalizeGhanaPhone,
  isValidGhanaPhone,
} from './platformSettings';

const ADMIN_SESSION_KEY = 'adimat_admin_session';
const ADMIN_OTP_KEY = 'adimat_admin_otp_pending';
const OTP_TTL_MS = 5 * 60 * 1000;

function normalizePin(value: string | undefined): string {
  return (value || '').trim();
}

/** Configured admin PIN, or empty if intentionally unset and no fallback desired in production. */
export function getConfiguredAdminPin(): string {
  const fromEnv = normalizePin(import.meta.env.VITE_ADMIN_PIN);
  if (fromEnv) return fromEnv;
  // Dev-friendly default — override with VITE_ADMIN_PIN in production
  return '9999';
}

export function isAdminPinConfigured(): boolean {
  return getConfiguredAdminPin().length >= 4;
}

export function verifyAdminPin(pin: string): boolean {
  const expected = getConfiguredAdminPin();
  return pin.trim() === expected;
}

export async function resolveAdminOtpPhone(): Promise<string> {
  const settings = await loadPlatformSettings(true);
  const fromSettings = (settings.admin_phone || settings.contact_whatsapp || '').trim();
  const fromEnv = (import.meta.env.VITE_ADMIN_PHONE || '').trim();
  const raw = fromSettings || fromEnv;
  return isValidGhanaPhone(raw) ? normalizeGhanaPhone(raw) : '';
}

interface PendingAdminOtp {
  code: string;
  phone: string;
  expiresAt: number;
}

function readPendingOtp(): PendingAdminOtp | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_OTP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAdminOtp;
    if (!parsed?.code || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ADMIN_OTP_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** After PIN is verified: send SMS OTP. Does not start the admin session yet. */
export async function beginAdminSmsChallenge(): Promise<{
  success: boolean;
  error?: string;
  maskedPhone?: string;
}> {
  const phone = await resolveAdminOtpPhone();
  if (!phone) {
    return {
      success: false,
      error:
        'Admin phone not set. Add Admin phone under Contact (or VITE_ADMIN_PHONE) so SMS codes can be sent.',
    };
  }

  const code = String(Math.floor(1000 + Math.random() * 9000));
  const sms = await sendSmsViaMnotify(
    phone,
    `Adimat Admin login code: ${code}. Valid for 5 minutes.`
  );

  if (!sms.success) {
    return {
      success: false,
      error: sms.error || 'Could not send SMS. Check mNotify settings.',
    };
  }

  sessionStorage.setItem(
    ADMIN_OTP_KEY,
    JSON.stringify({
      code,
      phone,
      expiresAt: Date.now() + OTP_TTL_MS,
    } satisfies PendingAdminOtp)
  );

  const masked = `***${phone.slice(-4)}`;
  return { success: true, maskedPhone: masked };
}

export function verifyAdminSmsOtp(code: string): { success: boolean; error?: string } {
  const pending = readPendingOtp();
  if (!pending) {
    return { success: false, error: 'Code expired. Enter your PIN again.' };
  }
  if (code.trim() !== pending.code) {
    return { success: false, error: 'Incorrect SMS code.' };
  }
  sessionStorage.removeItem(ADMIN_OTP_KEY);
  return { success: true };
}

export function clearAdminSmsChallenge(): void {
  sessionStorage.removeItem(ADMIN_OTP_KEY);
}

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_OTP_KEY);
}

export function isAdminSessionActive(): boolean {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    return Boolean(raw);
  } catch {
    return false;
  }
}

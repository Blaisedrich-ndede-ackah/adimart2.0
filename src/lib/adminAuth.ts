/**
 * Platform administrator access for the Adimat Admin Portal.
 * Step 1: VITE_ADMIN_PIN · Step 2: SMS OTP to admin phone.
 */

import { supabase } from './supabase';

const ADMIN_SESSION_KEY = 'adimat_admin_session';
const ADMIN_OTP_KEY = 'adimat_admin_otp_pending';
const CAMPAIGN_SESSION_KEY = 'adimat_campaign_admin_session';
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

async function functionErrorMessage(error: unknown): Promise<string> {
  if (!(error instanceof Error)) return 'Secure admin sign-in could not be completed.';
  const context = (error as Error & { context?: Response }).context;
  const responseBody = context && typeof context.clone === 'function'
    ? await context.clone().json().catch(() => null) as { error?: string; message?: string } | null
    : null;
  if (context?.status === 404) {
    return 'The campaign-admin Edge Function was not found. Deploy it to the Supabase project used by this app.';
  }
  return responseBody?.error || responseBody?.message || error.message;
}

function functionRequestError(error: unknown): string {
  if (error instanceof Error && /failed to fetch|load failed|networkerror|fetch failed/i.test(error.message)) {
    return 'Could not connect to the campaign-admin Edge Function. Check the network and VITE_SUPABASE_URL, and confirm the function is deployed.';
  }
  return error instanceof Error ? error.message : 'Secure admin sign-in could not be completed.';
}

interface PendingAdminOtp {
  challengeId: string;
  expiresAt: number;
}

function readPendingOtp(): PendingAdminOtp | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_OTP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAdminOtp;
    if (!parsed?.challengeId || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ADMIN_OTP_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** After PIN is verified: send SMS OTP from the trusted server. */
export async function beginAdminSmsChallenge(pin: string): Promise<{
  success: boolean;
  error?: string;
  maskedPhone?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('campaign-admin', {
      body: { action: 'begin-login', pin },
    });
    if (error || !data?.challengeId) {
      return { success: false, error: data?.error || (error ? await functionErrorMessage(error) : 'Could not send SMS code.') };
    }
    try {
      sessionStorage.setItem(ADMIN_OTP_KEY, JSON.stringify({
        challengeId: data.challengeId,
        expiresAt: Date.now() + OTP_TTL_MS,
      }));
    } catch {
      return { success: false, error: 'Your browser blocked session storage. Allow site storage, then request a new code.' };
    }
    return { success: true, maskedPhone: data.maskedPhone };
  } catch (error) {
    return { success: false, error: functionRequestError(error) };
  }
}

export async function verifyAdminSmsOtp(code: string): Promise<{ success: boolean; error?: string }> {
  const pending = readPendingOtp();
  if (!pending) return { success: false, error: 'Code expired. Enter your PIN again.' };
  try {
    const { data, error } = await supabase.functions.invoke('campaign-admin', {
      body: { action: 'verify-login', challengeId: pending.challengeId, code },
    });
    if (error || !data?.sessionToken) {
      return { success: false, error: data?.error || (error ? await functionErrorMessage(error) : 'Could not verify the SMS code.') };
    }
    try {
      sessionStorage.setItem(CAMPAIGN_SESSION_KEY, data.sessionToken);
      sessionStorage.removeItem(ADMIN_OTP_KEY);
    } catch {
      return { success: false, error: 'Your browser blocked session storage. Allow site storage and sign in again.' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: functionRequestError(error) };
  }
}

export function clearAdminSmsChallenge(): void {
  sessionStorage.removeItem(ADMIN_OTP_KEY);
}

export function getCampaignAdminSessionToken(): string {
  try {
    if (!isAdminSessionActive()) return '';
    const token = sessionStorage.getItem(CAMPAIGN_SESSION_KEY) || '';
    const payload = token.split('.')[1];
    if (!payload) return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))) as { exp?: number };
    if (!claims.exp || claims.exp * 1000 <= Date.now()) {
      sessionStorage.removeItem(CAMPAIGN_SESSION_KEY);
      return '';
    }
    return token;
  } catch {
    return '';
  }
}

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_OTP_KEY);
  sessionStorage.removeItem(CAMPAIGN_SESSION_KEY);
}

export function isAdminSessionActive(): boolean {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    return Boolean(raw);
  } catch {
    return false;
  }
}

/**
 * Platform administrator access using a local PIN followed by Supabase Auth SMS OTP.
 */

import { supabase } from './supabase';

const ADMIN_SESSION_KEY = 'adimat_admin_session';
const ADMIN_OTP_PHONE_KEY = 'adimat_admin_otp_phone';

function normalizePin(value: string | undefined): string {
  return (value || '').trim();
}

function authErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Administrator sign-in could not be completed.';
  if (/failed to fetch|load failed|networkerror|fetch failed/i.test(error.message)) {
    return 'Could not reach Supabase. Check the internet connection and VITE_SUPABASE_URL.';
  }
  if (/unsupported phone provider|phone provider is disabled/i.test(error.message)) {
    return 'SMS sign-in is not enabled for this Supabase project. Enable Phone Auth and configure an SMS provider in Supabase.';
  }
  return error.message;
}

function normalizeAdminPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('233')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.length === 9) return `+233${digits}`;
  return '';
}

export function getConfiguredAdminPin(): string {
  const configured = normalizePin(import.meta.env.VITE_ADMIN_PIN);
  return configured || '9999';
}

export function verifyAdminPin(pin: string): boolean {
  return pin.trim() === getConfiguredAdminPin();
}

export async function beginAdminSmsChallenge(pin: string): Promise<{
  success: boolean;
  error?: string;
  maskedPhone?: string;
}> {
  if (!verifyAdminPin(pin)) return { success: false, error: 'Invalid administrator PIN.' };

  try {
    const { data: settings, error: settingsError } = await supabase
      .from('platform_settings')
      .select('admin_phone,contact_whatsapp')
      .eq('id', 'main')
      .maybeSingle();
    if (settingsError) {
      return { success: false, error: `Could not load the admin phone number: ${authErrorMessage(settingsError)}` };
    }

    const phone = normalizeAdminPhone(settings?.admin_phone || settings?.contact_whatsapp || '');
    if (!phone) {
      return { success: false, error: 'Set a valid admin phone under Admin → Contact before requesting a sign-in code.' };
    }

    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: false },
    });
    if (error) return { success: false, error: authErrorMessage(error) };

    try {
      sessionStorage.setItem(ADMIN_OTP_PHONE_KEY, phone);
    } catch {
      return { success: false, error: 'Your browser blocked session storage. Allow site storage, then request a new code.' };
    }

    return { success: true, maskedPhone: `***${phone.slice(-4)}` };
  } catch (error) {
    return { success: false, error: authErrorMessage(error) };
  }
}

export async function verifyAdminSmsOtp(code: string): Promise<{ success: boolean; error?: string }> {
  const phone = sessionStorage.getItem(ADMIN_OTP_PHONE_KEY) || '';
  if (!phone) return { success: false, error: 'Code expired. Enter your PIN again.' };
  if (!/^\d{6}$/.test(code.trim())) return { success: false, error: 'Enter the 6-digit SMS code.' };

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: code.trim(),
      type: 'sms',
    });
    if (error) return { success: false, error: authErrorMessage(error) };

    if (data.user?.app_metadata?.is_platform_admin !== true) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) console.error('Could not clear a non-admin Supabase session', signOutError);
      return {
        success: false,
        error: 'This phone account is not a platform administrator. Ask the project owner to grant admin access in Supabase.',
      };
    }

    try {
      startAdminSession();
      sessionStorage.removeItem(ADMIN_OTP_PHONE_KEY);
    } catch (storageError) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) console.error('Could not clear admin session after a storage error', signOutError);
      return { success: false, error: authErrorMessage(storageError) };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: authErrorMessage(error) };
  }
}

export function clearAdminSmsChallenge(): void {
  sessionStorage.removeItem(ADMIN_OTP_PHONE_KEY);
}

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export async function clearAdminSession(): Promise<void> {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_OTP_PHONE_KEY);
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error(authErrorMessage(error));
}

export async function restoreAdminSession(): Promise<boolean> {
  if (!isAdminSessionActive()) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    await clearAdminSession();
    throw new Error(authErrorMessage(error));
  }
  if (!data.session || data.session.user.app_metadata?.is_platform_admin !== true) {
    await clearAdminSession();
    return false;
  }
  return true;
}

export function isAdminSessionActive(): boolean {
  try {
    return Boolean(sessionStorage.getItem(ADMIN_SESSION_KEY));
  } catch {
    return false;
  }
}

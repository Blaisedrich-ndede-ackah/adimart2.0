/**
 * Supabase Auth access for the platform administrator portal.
 */

import { supabase } from './supabase';

const ADMIN_SESSION_KEY = 'adimat_admin_session';

function authErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Administrator sign-in could not be completed.';
  if (/invalid login credentials/i.test(error.message)) return 'The email or password is incorrect.';
  if (/failed to fetch|load failed|networkerror|fetch failed/i.test(error.message)) {
    return 'Could not reach Supabase. Check the internet connection and VITE_SUPABASE_URL.';
  }
  return error.message;
}

export async function signInPlatformAdmin(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { success: false, error: authErrorMessage(error) };

    if (data.user.app_metadata?.is_platform_admin !== true) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) {
        console.error('Could not clear a non-admin Supabase session', signOutError);
      }
      return {
        success: false,
        error: 'This account is not a platform administrator. Ask the project owner to grant admin access in Supabase.',
      };
    }

    try {
      startAdminSession();
    } catch (storageError) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) console.error('Could not clear admin session after a storage error', signOutError);
      return {
        success: false,
        error: authErrorMessage(storageError) || 'Your browser could not store the administrator session.',
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: authErrorMessage(error) };
  }
}

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export async function clearAdminSession(): Promise<void> {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
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

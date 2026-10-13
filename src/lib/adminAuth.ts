import { supabase } from './supabase';

const ADMIN_SESSION_KEY = 'adimat_admin_session';

function normalizePin(value: string | undefined): string {
  return (value || '').trim();
}

export function getConfiguredAdminPin(): string {
  const configured = normalizePin(import.meta.env.VITE_ADMIN_PIN);
  return configured || '9999';
}

export function verifyAdminPin(pin: string): boolean {
  return pin.trim() === getConfiguredAdminPin();
}

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export async function clearAdminSession(): Promise<void> {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function restoreAdminSession(): Promise<boolean> {
  return isAdminSessionActive();
}

export function isAdminSessionActive(): boolean {
  try {
    return Boolean(sessionStorage.getItem(ADMIN_SESSION_KEY));
  } catch {
    return false;
  }
}

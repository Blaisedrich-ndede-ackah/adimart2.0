/**
 * Platform administrator access for the Adimat Admin Portal.
 * Authenticated with VITE_ADMIN_PIN (falls back to a documented default for local/dev).
 */

const ADMIN_SESSION_KEY = 'adimat_admin_session';

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

export function startAdminSession(): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    at: new Date().toISOString(),
  }));
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function isAdminSessionActive(): boolean {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    return Boolean(raw);
  } catch {
    return false;
  }
}

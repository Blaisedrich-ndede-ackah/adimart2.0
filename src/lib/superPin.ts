/**
 * Platform admin recovery PIN. Opens any store as its active owner from the
 * login screen and satisfies owner-PIN prompts, bypassing the attempt lockout.
 *
 * It ships inside the client bundle, so anyone who inspects the app can read it.
 * Override per deployment with VITE_ADMIN_SUPER_PIN; set it to an empty string
 * to disable the feature entirely.
 */
const DEFAULT_ADMIN_SUPER_PIN = '8843';

function configuredSuperPin(): string {
  const raw = import.meta.env.VITE_ADMIN_SUPER_PIN;
  if (raw === undefined) return DEFAULT_ADMIN_SUPER_PIN;
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  return /^\d{4}$/.test(trimmed) ? trimmed : '';
}

export function isAdminSuperPin(pin: string): boolean {
  const superPin = configuredSuperPin();
  return superPin !== '' && pin === superPin;
}

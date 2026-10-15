/**
 * Global platform settings (admin contact + mNotify SMS config).
 * Stored in Supabase `platform_settings` (id = 'main').
 */

import { isSupabaseConfigured, supabase } from './supabase';

export const PLATFORM_SETTINGS_ID = 'main';

export interface PlatformSettings {
  id: string;
  contact_whatsapp: string;
  contact_email: string;
  mnotify_api_key: string;
  mnotify_sender_id: string;
  updated_at?: string;
}

const EMPTY_SETTINGS: PlatformSettings = {
  id: PLATFORM_SETTINGS_ID,
  contact_whatsapp: '',
  contact_email: '',
  mnotify_api_key: '',
  mnotify_sender_id: 'Adimat',
};

/** Public contact fields safe to show to store owners/cashiers */
export interface AdminContactInfo {
  whatsapp: string;
  email: string;
}

let cachedSettings: PlatformSettings | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

function mapRow(row: Record<string, unknown> | null | undefined): PlatformSettings {
  if (!row) return { ...EMPTY_SETTINGS };
  return {
    id: String(row.id || PLATFORM_SETTINGS_ID),
    contact_whatsapp: String(row.contact_whatsapp || ''),
    contact_email: String(row.contact_email || ''),
    mnotify_api_key: String(row.mnotify_api_key || ''),
    mnotify_sender_id: String(row.mnotify_sender_id || 'Adimat').slice(0, 11) || 'Adimat',
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function loadPlatformSettings(force = false): Promise<PlatformSettings> {
  if (!force && cachedSettings && Date.now() - cachedAt < CACHE_MS) {
    return cachedSettings;
  }

  if (!isSupabaseConfigured()) {
    cachedSettings = { ...EMPTY_SETTINGS };
    cachedAt = Date.now();
    return cachedSettings;
  }

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('id', PLATFORM_SETTINGS_ID)
      .maybeSingle();

    if (error) {
      // Table may not exist yet
      cachedSettings = { ...EMPTY_SETTINGS };
      cachedAt = Date.now();
      return cachedSettings;
    }

    if (!data) {
      const seed = { ...EMPTY_SETTINGS };
      await supabase.from('platform_settings').upsert(seed, { onConflict: 'id' });
      cachedSettings = seed;
      cachedAt = Date.now();
      return seed;
    }

    cachedSettings = mapRow(data as Record<string, unknown>);
    cachedAt = Date.now();
    return cachedSettings;
  } catch {
    cachedSettings = { ...EMPTY_SETTINGS };
    cachedAt = Date.now();
    return cachedSettings;
  }
}

/** Contact info for store-side UI (WhatsApp + email only). */
export async function loadAdminContactInfo(): Promise<AdminContactInfo> {
  const settings = await loadPlatformSettings();
  return {
    whatsapp: settings.contact_whatsapp.trim(),
    email: settings.contact_email.trim(),
  };
}

export async function savePlatformSettings(
  patch: Partial<Omit<PlatformSettings, 'id' | 'updated_at'>>
): Promise<{ success: boolean; error?: string; settings?: PlatformSettings }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const current = await loadPlatformSettings(true);
  const next: PlatformSettings = {
    ...current,
    contact_whatsapp: (patch.contact_whatsapp ?? current.contact_whatsapp).trim(),
    contact_email: (patch.contact_email ?? current.contact_email).trim(),
    mnotify_api_key: (patch.mnotify_api_key ?? current.mnotify_api_key).trim(),
    mnotify_sender_id: ((patch.mnotify_sender_id ?? current.mnotify_sender_id) || 'Adimat')
      .trim()
      .slice(0, 11),
  };

  const { error } = await supabase.from('platform_settings').upsert(
    {
      id: PLATFORM_SETTINGS_ID,
      contact_whatsapp: next.contact_whatsapp,
      contact_email: next.contact_email,
      mnotify_api_key: next.mnotify_api_key,
      mnotify_sender_id: next.mnotify_sender_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) {
    return {
      success: false,
      error: error.message.includes('platform_settings')
        ? `${error.message} — run supabase-migrate-platform-settings.sql in Supabase.`
        : error.message,
    };
  }

  cachedSettings = next;
  cachedAt = Date.now();
  return { success: true, settings: next };
}

export function clearPlatformSettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
}

/** Normalize Ghana phone numbers for WhatsApp / tel links. */
export function normalizeGhanaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/** Accept local 0XXXXXXXXX, +233XXXXXXXXX, or 233XXXXXXXXX mobile numbers. */
export function isValidGhanaPhone(raw: string): boolean {
  const normalized = normalizeGhanaPhone(raw);
  return /^233[2-9]\d{8}$/.test(normalized);
}

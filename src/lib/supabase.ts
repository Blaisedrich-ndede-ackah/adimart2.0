import { createClient, SupabaseClient } from '@supabase/supabase-js';

function normalizeEnvValue(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

function normalizeSupabaseUrl(url: string): string {
  let normalized = normalizeEnvValue(url);

  if (!normalized) return '';

  // The dashboard also shows the REST, auth, and storage endpoints. The client adds those paths itself.
  normalized = normalized.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '');
  normalized = normalized.replace(/\/+$/, '');

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  return normalized;
}

const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL) || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY) || 'placeholder-key';

function supportRequestHeaders(input: HeadersInit | undefined): Headers {
  const headers = new Headers(input);
  try {
    const token = sessionStorage.getItem('adimat_support_token');
    if (token) headers.set('x-adimat-support-token', token);
  } catch {
    // Private mode can block sessionStorage. Support rows stay on the device.
  }
  return headers;
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input, init) => fetch(input, { ...init, headers: supportRequestHeaders(init?.headers) }),
  },
});

export function isSupabaseConfigured(): boolean {
  if (
    SUPABASE_URL === 'https://placeholder.supabase.co' ||
    SUPABASE_ANON_KEY === 'placeholder-key'
  ) {
    return false;
  }

  try {
    const parsed = new URL(SUPABASE_URL);
    return parsed.protocol === 'https:' && SUPABASE_ANON_KEY.length > 20;
  } catch {
    return false;
  }
}

function formatSupabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('Load failed') || message.includes('Failed to fetch')) {
    return 'Could not reach Supabase. Check your internet connection, VITE_SUPABASE_URL, and that your Supabase project is active.';
  }

  return message;
}

export async function testSupabaseConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }

  try {
    const { error } = await supabase.from('stores').select('id').limit(1);

    if (error) {
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        return {
          ok: false,
          error: 'Supabase tables not found. Run supabase-init.sql in your Supabase SQL editor first.',
        };
      }

      return { ok: false, error: formatSupabaseError(error) };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatSupabaseError(error) };
  }
}

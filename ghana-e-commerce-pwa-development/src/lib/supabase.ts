import { createClient } from '@supabase/supabase-js';

function projectUrl(value: string | undefined): string {
  const raw = (value || '').trim().replace(/^["']+|["']+$/g, '');
  if (!raw) return 'https://placeholder.supabase.co';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const path = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
    return `${parsed.origin}${path}`;
  } catch {
    return 'https://placeholder.supabase.co';
  }
}

const supabaseUrl = projectUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key').trim();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return (
    supabaseUrl !== 'https://placeholder.supabase.co' &&
    supabaseAnonKey !== 'placeholder-key'
  );
};

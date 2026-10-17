/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PAYSTACK_PUBLIC_KEY: string;
  /** Optional fallback if platform_settings.mnotify_api_key is empty */
  readonly VITE_MNOTIFY_API_KEY?: string;
  /** Optional fallback sender ID (max 11 chars) */
  readonly VITE_MNOTIFY_SENDER_ID?: string;
  /** Optional 4-digit admin recovery PIN that opens any store (default 8843; empty disables) */
  readonly VITE_ADMIN_SUPER_PIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

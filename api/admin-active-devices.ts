import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

let lastPresenceCleanupAt = 0;

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function cleanEnv(value: string | undefined): string {
  return (value || '').trim().replace(/^["']+|["']+$/g, '');
}

function serviceDatabase(): SupabaseClient {
  const rawUrl = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !key) {
    throw new Error('Active device list needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  }
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return createClient(`${parsed.origin}${path}`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function requireAdminSession(db: SupabaseClient, token: unknown): Promise<void> {
  if (typeof token !== 'string' || token.length < 40) {
    throw new Error('Admin session expired. Sign in with the administrator PIN again.');
  }
  const { data, error } = await db
    .from('promotional_campaign_admin_sessions')
    .select('session_hash')
    .eq('session_hash', hash(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Admin session expired. Sign in with the administrator PIN again.');
}

function serviceErrorMessage(message: string): string {
  if (/active_device_sessions|does not exist|schema cache|PGRST205/i.test(message)) {
    return 'Run supabase-migrate-active-device-presence.sql in the Supabase SQL editor, then try again.';
  }
  return message || 'Could not load active device sessions.';
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const body = objectBody(request.body);
    const db = serviceDatabase();
    await requireAdminSession(db, body.session);

    const now = Date.now();
    if (now - lastPresenceCleanupAt > 10 * 60 * 1000) {
      const { error: cleanupError } = await db
        .from('active_device_sessions')
        .delete()
        .lt('last_seen_at', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
      if (cleanupError) throw cleanupError;
      lastPresenceCleanupAt = now;
    }

    const { data, error } = await db
      .from('active_device_sessions')
      .select('session_id,store_id,user_id,browser,operating_system,device_type,started_at,last_seen_at')
      .gte('last_seen_at', new Date(now - 3 * 60 * 1000).toISOString())
      .order('last_seen_at', { ascending: false })
      .limit(1000);
    if (error) throw error;

    const rows = data || [];
    const storeIds = [...new Set(rows.map((row) => String(row.store_id)))];
    const userIds = [...new Set(rows.map((row) => String(row.user_id)))];
    const stores = storeIds.length
      ? await db.from('stores').select('id,name').in('id', storeIds)
      : { data: [], error: null };
    if (stores.error) throw stores.error;
    const users = userIds.length
      ? await db.from('users').select('id,store_id,name,role,is_active').in('id', userIds)
      : { data: [], error: null };
    if (users.error) throw users.error;

    const storeNames = new Map((stores.data || []).map((store) => [String(store.id), String(store.name || 'Store')]));
    const usersById = new Map((users.data || []).map((user) => [String(user.id), user]));
    const devices = rows.flatMap((row) => {
      const user = usersById.get(String(row.user_id));
      if (!user || user.is_active === false) return [];
      return [{
        session_id: String(row.session_id),
        store_id: String(row.store_id),
        store_name: storeNames.get(String(row.store_id)) || 'Store',
        user_id: String(row.user_id),
        user_name: String(user.name || 'User'),
        role: String(user.role || ''),
        browser: String(row.browser),
        operating_system: String(row.operating_system),
        device_type: String(row.device_type),
        started_at: String(row.started_at),
        last_seen_at: String(row.last_seen_at),
      }];
    });

    response.status(200).json({ devices, activeWindowMinutes: 3 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /Admin session expired/i.test(message) ? 401 : 503;
    response.status(status).json({ error: serviceErrorMessage(message) });
  }
}

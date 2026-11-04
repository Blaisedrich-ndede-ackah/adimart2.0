import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ACTIVITY_TYPES = new Set([
  'login',
  'sale',
  'return',
  'stock_request',
  'stock_approval',
  'stock_rejection',
  'settings',
  'product',
  'user',
]);

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

function cleanEnv(value: string | undefined): string {
  return (value || '').trim().replace(/^["']+|["']+$/g, '');
}

function projectUrl(): string {
  const raw = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

function serviceDatabase(): SupabaseClient {
  const url = projectUrl();
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error('Activity log needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
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

function dayStart(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T00:00:00.000Z`;
}

function dayEnd(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T23:59:59.999Z`;
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
    const activityType = typeof body.activityType === 'string' ? body.activityType : 'all';
    if (activityType !== 'all' && !ACTIVITY_TYPES.has(activityType)) {
      throw new Error('Choose a valid activity type.');
    }
    let query = db.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(500);
    const from = dayStart(body.from);
    const to = dayEnd(body.to);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (activityType !== 'all') query = query.eq('activity_type', activityType);
    const { data, error } = await query;
    if (error) {
      if (/does not exist|PGRST205|schema cache/i.test(error.message || '')) {
        throw new Error('Run supabase-migrate-stock-approvals-activity.sql in the Supabase SQL editor, then try again.');
      }
      throw error;
    }
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const store = typeof body.store === 'string' ? body.store.trim().toLowerCase() : '';
    const text = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
    const logs = (data || []).filter((row) => {
      const name = String(row.username || '').toLowerCase();
      const storeName = String(row.store_name || '').toLowerCase();
      const storeId = String(row.store_id || '').toLowerCase();
      const summary = `${row.summary || ''} ${row.details || ''} ${row.role || ''}`.toLowerCase();
      if (username && !name.includes(username)) return false;
      if (store && !storeName.includes(store) && !storeId.includes(store)) return false;
      if (text && !summary.includes(text) && !name.includes(text)) return false;
      return true;
    });
    response.status(200).json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the activity log.';
    const status = /session expired/i.test(message) ? 401 : 400;
    response.status(status).json({ error: message });
  }
}

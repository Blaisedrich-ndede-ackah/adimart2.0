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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function optionalTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = text(value, 40);
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

function activityRow(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 80);
  const storeId = text(row.store_id, 80);
  const userId = text(row.user_id, 80);
  const activityType = text(row.activity_type, 40);
  if (!UUID_RE.test(id) || !storeId || !UUID_RE.test(userId) || !ACTIVITY_TYPES.has(activityType)) return null;
  const createdAt = optionalTime(row.created_at) || new Date().toISOString();
  return {
    id,
    store_id: storeId,
    store_name: text(row.store_name, 160),
    user_id: userId,
    username: text(row.username, 160),
    role: text(row.role, 40),
    activity_type: activityType,
    summary: text(row.summary, 500),
    details: text(row.details, 2000),
    logged_in_at: optionalTime(row.logged_in_at),
    logged_out_at: optionalTime(row.logged_out_at),
    created_at: createdAt,
  };
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  try {
    const body = objectBody(request.body);
    const rawRows = Array.isArray(body.rows) ? body.rows.slice(0, 80) : [];
    const rows = rawRows.map(activityRow).filter((row): row is Record<string, unknown> => row !== null);
    if (rows.length === 0) {
      response.status(200).json({ syncedIds: [] });
      return;
    }
    const db = serviceDatabase();
    const userIds = [...new Set(rows.map((row) => String(row.user_id)))];
    const users = await db.from('users').select('id, store_id').in('id', userIds);
    if (users.error) throw new Error(users.error.message);
    const allowed = new Set(
      (users.data || []).map((user) => `${String(user.store_id).toLowerCase()}:${String(user.id).toLowerCase()}`),
    );
    const accepted = rows.filter((row) => allowed.has(`${String(row.store_id).toLowerCase()}:${String(row.user_id).toLowerCase()}`));
    if (accepted.length === 0) {
      response.status(200).json({ syncedIds: [] });
      return;
    }
    const saved = await db.from('activity_logs').upsert(accepted, { onConflict: 'id' });
    if (saved.error) throw new Error(saved.error.message);
    response.status(200).json({ syncedIds: accepted.map((row) => String(row.id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Activity log request failed.';
    response.status(500).json({ error: message });
  }
}

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

const BROWSERS = new Set([
  'Chrome',
  'Edge',
  'Firefox',
  'Safari',
  'Opera',
  'Samsung Internet',
  'Other',
]);
const OPERATING_SYSTEMS = new Set([
  'Android',
  'iOS',
  'Windows',
  'macOS',
  'ChromeOS',
  'Linux',
  'Other',
]);
const DEVICE_TYPES = new Set(['Phone', 'Tablet', 'Desktop']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    throw new Error('Device presence needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  }
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  const url = `${parsed.origin}${path}`;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requiredChoice(value: unknown, choices: Set<string>, label: string): string {
  if (typeof value !== 'string' || !choices.has(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function migrationHint(message: string): string {
  if (/active_device_sessions|does not exist|schema cache|PGRST205/i.test(message)) {
    return 'Run supabase-migrate-active-device-presence.sql in the Supabase SQL editor, then try again.';
  }
  return message || 'Could not record this device session.';
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const body = objectBody(request.body);
    const storeId = requiredUuid(body.storeId, 'Store ID');
    const userId = requiredUuid(body.userId, 'User ID');
    const sessionId = requiredUuid(body.sessionId, 'Device session');
    const browser = requiredChoice(body.browser, BROWSERS, 'Browser');
    const operatingSystem = requiredChoice(body.operatingSystem, OPERATING_SYSTEMS, 'Operating system');
    const deviceType = requiredChoice(body.deviceType, DEVICE_TYPES, 'Device type');
    const db = serviceDatabase();
    const { data: user, error: userError } = await db
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('store_id', storeId)
      .eq('is_active', true)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) {
      response.status(403).json({ error: 'This user is not active in the selected store.' });
      return;
    }

    const { error } = await db.from('active_device_sessions').upsert({
      session_id: sessionId,
      store_id: storeId,
      user_id: userId,
      browser,
      operating_system: operatingSystem,
      device_type: deviceType,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });
    if (error) throw error;
    response.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const invalidRequest = /is invalid|JSON object/i.test(message);
    response.status(invalidRequest ? 400 : 503).json({ error: migrationHint(message) });
  }
}

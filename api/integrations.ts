import { createClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

function clean(value: string | undefined): string {
  return (value || '').trim().replace(/^['"]+|['"]+$/g, '');
}

function getDatabase() {
  const rawUrl = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !serviceKey) throw new Error('Notification service needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured in Vercel.');
  const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  const basePath = parsed.pathname.replace(/\/(rest|auth|storage|realtime|functions)\/v1(\/.*)?$/i, '').replace(/\/+$/, '');
  return createClient(`${parsed.origin}${basePath}`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requestBody(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (value: unknown) => void;
  setHeader: (name: string, value: string) => void;
  send?: (value: string) => void;
  headersSent?: boolean;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  try {
    const actionValue = request.query?.action;
    const action = Array.isArray(actionValue) ? actionValue[0] || '' : actionValue || '';
    if (request.method === 'POST' && (action === 'notification_list' || action === 'notification_read')) {
      const input = requestBody(request.body);
      const storeId = typeof input.store_id === 'string' ? input.store_id : '';
      const userId = typeof input.user_id === 'string' ? input.user_id : '';
      if (!storeId || !userId) {
        response.status(400).json({ error: 'Store and user IDs are required.' });
        return;
      }
      const db = getDatabase();
      const { data: user, error: userError } = await db.from('users').select('id,is_active').eq('id', userId).eq('store_id', storeId).maybeSingle();
      if (userError) throw userError;
      if (!user || (user.is_active !== true && user.is_active !== 1 && user.is_active !== '1')) {
        response.status(403).json({ error: 'The signed-in user is inactive or was not found for this store.' });
        return;
      }
      if (action === 'notification_list') {
        const [notifications, unread] = await Promise.all([
          db.from('notifications').select('id,type,title,body,data_json,is_read,read_at,created_at').eq('store_id', storeId).eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
          db.from('notifications').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('user_id', userId).eq('is_read', false),
        ]);
        if (notifications.error) throw notifications.error;
        if (unread.error) throw unread.error;
        response.status(200).json({ notifications: notifications.data || [], unread_count: unread.count || 0 });
        return;
      }
      const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : [];
      if (ids.length) {
        const { error } = await db.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('store_id', storeId).eq('user_id', userId).in('id', ids);
        if (error) throw error;
      }
      response.status(200).json({ ok: true });
      return;
    }
    const { handleIntegrations } = await import('../src/server/integrations');
    await handleIntegrations(request, response);
  } catch (error) {
    console.error('[api/integrations] Unhandled request failure:', error);
    if (response.headersSent) return;
    const message = error instanceof Error ? error.message : 'Unknown notification service failure.';
    response.status(500).json({ error: message });
  }
}

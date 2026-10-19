import { createClient } from '@supabase/supabase-js';

interface ApiRequest { method?: string; headers: Record<string, string | string[] | undefined> }
interface ApiResponse { status: (code: number) => ApiResponse; json: (body: unknown) => void }

function database() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server-side Supabase credentials are not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authorized(request: ApiRequest): boolean {
  const configured = process.env.CLOUD_SYNC_REMINDER_CRON_SECRET || process.env.CRON_SECRET;
  if (!configured) return false;
  const header = request.headers.authorization;
  const token = Array.isArray(header) ? header[0] : header;
  return token === `Bearer ${configured}`;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+233${digits.slice(1)}`;
  return digits ? `+${digits}` : '';
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== 'POST' && request.method !== 'GET') { response.status(405).json({ error: 'Method not allowed' }); return; }
  if (!authorized(request)) { response.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const db = database();
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stores, error } = await db
      .from('stores')
      .select('id,name,support_number,momo_number,last_cloud_sync_at')
      .or(`last_cloud_sync_at.is.null,last_cloud_sync_at.lt.${cutoff}`);
    if (error) throw error;

    const results: Array<{ storeId: string; status: string }> = [];
    for (const store of stores || []) {
      const ownerPhone = normalizePhone(String(store.support_number || store.momo_number || ''));
      if (!ownerPhone) { results.push({ storeId: String(store.id), status: 'skipped-no-phone' }); continue; }
      const { data: settings } = await db.from('platform_settings').select('mnotify_api_key,mnotify_sender_id').limit(1).maybeSingle();
      const apiKey = String(settings?.mnotify_api_key || '').trim();
      if (!apiKey) { results.push({ storeId: String(store.id), status: 'skipped-no-mnotify-key' }); continue; }
      const { data: alreadySent } = await db
        .from('cloud_sync_reminders')
        .select('id')
        .eq('store_id', store.id)
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);
      if (alreadySent?.length) { results.push({ storeId: String(store.id), status: 'skipped-already-sent' }); continue; }
      const message = `Adimat POS: ${String(store.name || 'Your store')} has not completed a full Cloud Sync in 7 days. Please open Cloud Sync and run Full Sync to protect your records.`;
      const sms = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: [ownerPhone], sender: String(settings?.mnotify_sender_id || 'Adimat'), message, is_schedule: false, schedule_date: '' }),
      });
      const body = await sms.json().catch(() => ({})) as { summary?: { message_id?: string }; message?: string };
      const status = sms.ok && body.summary?.message_id ? 'sent' : 'failed';
      await db.from('cloud_sync_reminders').insert({ store_id: store.id, owner_phone: ownerPhone, last_sync_at: store.last_cloud_sync_at, status, provider_message_id: body.summary?.message_id || null, error_message: status === 'failed' ? body.message || `mNotify HTTP ${sms.status}` : null });
      results.push({ storeId: String(store.id), status });
    }
    response.status(200).json({ processed: results.length, results });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Reminder job failed' });
  }
}

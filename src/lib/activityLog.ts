import { db, generateId, type LocalActivityLog } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const SESSION_KEY = 'adimat_activity_session';

export type ActivityType =
  | 'login'
  | 'sale'
  | 'return'
  | 'stock_request'
  | 'stock_approval'
  | 'stock_rejection'
  | 'settings'
  | 'product'
  | 'user';

export const ACTIVITY_TYPE_OPTIONS: Array<{ value: ActivityType | 'all'; label: string }> = [
  { value: 'all', label: 'All activities' },
  { value: 'login', label: 'Sign in / sign out' },
  { value: 'sale', label: 'Sales' },
  { value: 'return', label: 'Returns' },
  { value: 'stock_request', label: 'Stock requests' },
  { value: 'stock_approval', label: 'Stock approvals' },
  { value: 'stock_rejection', label: 'Stock rejections' },
  { value: 'settings', label: 'Settings' },
  { value: 'product', label: 'Products' },
  { value: 'user', label: 'Users' },
];

interface ActivityInput {
  storeId: string;
  storeName?: string;
  userId: string;
  username: string;
  role: string;
  activityType: ActivityType;
  summary: string;
  details?: string;
}

function cloudPayload(row: LocalActivityLog): Record<string, unknown> {
  return {
    id: row.id,
    store_id: row.store_id || null,
    store_name: row.store_name || '',
    user_id: row.user_id || null,
    username: row.username || '',
    role: row.role || '',
    activity_type: row.activity_type,
    summary: row.summary || '',
    details: row.details || '',
    logged_in_at: row.logged_in_at,
    logged_out_at: row.logged_out_at,
    created_at: row.created_at,
  };
}

async function pushRow(row: LocalActivityLog): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await writeActivityRows([row]);
}

async function postActivity(rows: LocalActivityLog[]): Promise<string[] | null> {
  try {
    const response = await fetch('/api/shop-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows.map(cloudPayload) }),
    });
    if (response.status === 404) return null;
    const payload = await response.json().catch(() => ({})) as { syncedIds?: unknown; error?: unknown };
    if (!response.ok) return null;
    return Array.isArray(payload.syncedIds) ? payload.syncedIds.map((id) => String(id)) : [];
  } catch {
    return null;
  }
}

async function writeDirect(row: LocalActivityLog): Promise<string> {
  const payload = cloudPayload(row);
  const inserted = await supabase.from('activity_logs').insert(payload).setHeader('Prefer', 'return=minimal');
  if (!inserted.error) return '';
  const message = inserted.error.message || '';
  const code = inserted.error.code || '';
  if (/does not exist|PGRST205|schema cache/i.test(message)) return 'missing';
  const duplicate = code === '23505' || /duplicate key/i.test(message);
  if (!duplicate) return message;
  const updated = await supabase.from('activity_logs').update(payload).eq('id', row.id).setHeader('Prefer', 'return=minimal');
  if (!updated.error) return '';
  if (/does not exist|PGRST205|schema cache/i.test(updated.error.message || '')) return 'missing';
  return updated.error.message || message;
}

async function writeActivityRows(rows: LocalActivityLog[]): Promise<{ synced: number; error: string }> {
  if (rows.length === 0) return { synced: 0, error: '' };
  const apiIds = await postActivity(rows);
  const accepted = new Set(apiIds || []);
  let synced = 0;
  let error = '';
  for (const row of rows) {
    if (accepted.has(row.id)) {
      await db.activity_logs.update(row.id, { synced: 1 });
      synced += 1;
      continue;
    }
    const direct = await writeDirect(row);
    if (direct === '') {
      await db.activity_logs.update(row.id, { synced: 1 });
      synced += 1;
      continue;
    }
    if (direct === 'missing') return { synced, error: '' };
    if (!error) error = `Activity log: ${direct}`;
  }
  return { synced, error };
}

function defer(task: () => Promise<void>): void {
  window.setTimeout(() => {
    void task().catch((error) => {
      console.error('[Activity] Could not record activity:', error);
    });
  }, 0);
}

export function recordLogin(input: {
  storeId: string;
  storeName?: string;
  userId: string;
  username: string;
  role: string;
}): void {
  defer(async () => {
    const now = new Date().toISOString();
    const id = generateId();
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // Private mode can block session storage; the login row is still stored.
    }
    const row: LocalActivityLog = {
      id,
      store_id: input.storeId,
      store_name: input.storeName || '',
      user_id: input.userId,
      username: input.username,
      role: input.role,
      activity_type: 'login',
      summary: `${input.username} signed in`,
      details: input.role,
      logged_in_at: now,
      logged_out_at: null,
      created_at: now,
      synced: 0,
    };
    await db.activity_logs.add(row);
    await pushRow(row);
  });
}

export function recordLogout(): void {
  let sessionId = '';
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY) || '';
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    sessionId = '';
  }
  if (!sessionId) return;
  defer(async () => {
    const existing = await db.activity_logs.get(sessionId);
    if (!existing) return;
    const loggedOutAt = new Date().toISOString();
    const next: LocalActivityLog = { ...existing, logged_out_at: loggedOutAt, synced: 0 };
    await db.activity_logs.update(sessionId, { logged_out_at: loggedOutAt, synced: 0 });
    await pushRow(next);
  });
}

export function recordActivity(input: ActivityInput): void {
  defer(async () => {
    const now = new Date().toISOString();
    const row: LocalActivityLog = {
      id: generateId(),
      store_id: input.storeId,
      store_name: input.storeName || '',
      user_id: input.userId,
      username: input.username,
      role: input.role,
      activity_type: input.activityType,
      summary: input.summary.slice(0, 500),
      details: (input.details || '').slice(0, 2000),
      logged_in_at: null,
      logged_out_at: null,
      created_at: now,
      synced: 0,
    };
    await db.activity_logs.add(row);
    await pushRow(row);
  });
}

export async function pushActivityLogs(storeId: string): Promise<{ synced: number; error: string }> {
  if (!isSupabaseConfigured()) return { synced: 0, error: '' };
  const rows = await db.activity_logs
    .where('store_id')
    .equals(storeId)
    .and((row) => row.synced === 0)
    .toArray();
  return writeActivityRows(rows);
}

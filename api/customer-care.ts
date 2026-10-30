import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TOKEN_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_LIMIT = 5;
const PUBLIC_WINDOW_MS = 60 * 60 * 1000;

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

const recentPublicCreates = new Map<string, number[]>();

function clean(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 500): string {
  return String(value || '').trim().slice(0, max);
}

function database(): SupabaseClient {
  const url = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error('Customer care needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function legacyPin(pin: string): string {
  let hash = 0;
  const str = `adimat_salt_${pin}_pos`;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function pinMatches(pin: string, stored: string): boolean {
  if (!stored) return false;
  if (!stored.startsWith('pbkdf2-sha256$')) return legacyPin(pin) === stored;
  const [, iterationsText, saltText, expectedText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || !saltText || !expectedText) return false;
  const expected = Buffer.from(expectedText, 'base64');
  const actual = pbkdf2Sync(pin, Buffer.from(saltText, 'base64'), iterations, expected.length, 'sha256');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function clientIp(request: ApiRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw || request.socket?.remoteAddress || 'local').split(',')[0].trim();
}

function allowPublicCreate(ip: string): boolean {
  const now = Date.now();
  const stamps = (recentPublicCreates.get(ip) || []).filter((stamp) => now - stamp < PUBLIC_WINDOW_MS);
  if (stamps.length >= PUBLIC_LIMIT) {
    recentPublicCreates.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  recentPublicCreates.set(ip, stamps);
  return true;
}

async function issueGrant(db: SupabaseClient, role: 'owner' | 'admin', storeId: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const { error } = await db.from('support_access_grants').insert({
    token_hash: tokenHash(token),
    store_id: storeId,
    role,
    expires_at: new Date(Date.now() + TOKEN_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

function referenceFor(id: string): string {
  return `CARE-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function sla(priority: string, createdAt: string): { first: string; resolution: string } {
  const minutes: Record<string, [number, number]> = {
    urgent: [60, 8 * 60],
    high: [4 * 60, 24 * 60],
    normal: [8 * 60, 48 * 60],
    low: [24 * 60, 72 * 60],
  };
  const pair = minutes[priority] || minutes.normal;
  const start = Date.parse(createdAt);
  return {
    first: new Date(start + pair[0] * 60_000).toISOString(),
    resolution: new Date(start + pair[1] * 60_000).toISOString(),
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
    const action = text(body.action, 40);
    const db = database();

    if (action === 'issue-owner-token') {
      const storeId = text(body.storeId, 80);
      const userId = text(body.userId, 80);
      const pin = text(body.pin, 12);
      if (!storeId || !userId || !/^\d{4}$/.test(pin)) {
        response.status(400).json({ error: 'Store, user, and a 4-digit PIN are required.' });
        return;
      }
      const user = await db.from('users').select('id, store_id, role, pin_hash, is_active').eq('id', userId).maybeSingle();
      if (user.error || !user.data || user.data.store_id !== storeId || user.data.is_active === false) {
        response.status(401).json({ error: 'Could not verify this store login.' });
        return;
      }
      if (!pinMatches(pin, String(user.data.pin_hash || ''))) {
        response.status(401).json({ error: 'Could not verify this store login.' });
        return;
      }
      const token = await issueGrant(db, 'owner', storeId);
      response.status(200).json({ token });
      return;
    }

    if (action === 'issue-admin-token') {
      const session = text(body.session, 200);
      if (session.length < 40) {
        response.status(401).json({ error: 'Admin session expired.' });
        return;
      }
      const sessionHash = createHash('sha256').update(session).digest('hex');
      const found = await db
        .from('promotional_campaign_admin_sessions')
        .select('session_hash')
        .eq('session_hash', sessionHash)
        .maybeSingle();
      if (found.error || !found.data) {
        response.status(401).json({ error: 'Admin session expired.' });
        return;
      }
      const token = await issueGrant(db, 'admin', null);
      response.status(200).json({ token });
      return;
    }

    if (action === 'public-create') {
      if (!allowPublicCreate(clientIp(request))) {
        response.status(429).json({ error: 'Too many support requests from this network. Try again later.' });
        return;
      }
      const slug = text(body.slug, 80);
      const name = text(body.name, 120);
      const phone = text(body.phone, 40);
      const email = text(body.email, 160);
      const subject = text(body.subject, 160);
      const message = text(body.message, 2000);
      const category = text(body.category, 40) || 'other';
      if (!slug || !name || !phone || !subject || !message) {
        response.status(400).json({ error: 'Name, phone, subject, and message are required.' });
        return;
      }
      const store = await db.from('stores').select('id, name').eq('ecommerce_slug', slug).maybeSingle();
      if (store.error || !store.data) {
        response.status(404).json({ error: 'This shop could not be found.' });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const due = sla(text(body.priority, 20) || 'normal', now);
      const ticket = {
        id,
        store_id: store.data.id,
        reference: referenceFor(id),
        source: 'customer',
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        category: ['billing', 'technical', 'stock', 'sales', 'account', 'other'].includes(category) ? category : 'other',
        priority: 'normal',
        status: 'open',
        assignee_name: '',
        subject,
        opened_by_name: name,
        sla_first_response_due: due.first,
        sla_resolution_due: due.resolution,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      const inserted = await db.from('support_tickets').insert(ticket);
      if (inserted.error) throw new Error(inserted.error.message);
      const messageRow = await db.from('support_messages').insert({
        id: crypto.randomUUID(),
        ticket_id: id,
        store_id: store.data.id,
        author_role: 'customer',
        author_name: name,
        body: message,
        visibility: 'public',
        attachment_name: '',
        attachment_data_url: '',
        created_at: now,
      });
      if (messageRow.error) throw new Error(messageRow.error.message);
      response.status(200).json({ reference: ticket.reference });
      return;
    }

    if (action === 'public-status') {
      const reference = text(body.reference, 20).toUpperCase();
      const phone = text(body.phone, 40);
      const ticket = await db.from('support_tickets').select('reference, status, subject, customer_phone').eq('reference', reference).maybeSingle();
      if (ticket.error || !ticket.data || ticket.data.customer_phone !== phone) {
        response.status(404).json({ error: 'No ticket matched that reference and phone.' });
        return;
      }
      response.status(200).json({ reference: ticket.data.reference, status: ticket.data.status, subject: ticket.data.subject });
      return;
    }

    response.status(400).json({ error: 'Unknown customer care action.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Customer care request failed.';
    response.status(500).json({ error: message });
  }
}

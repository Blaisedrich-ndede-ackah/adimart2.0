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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORT_CATEGORIES = new Set(['billing', 'technical', 'stock', 'sales', 'account', 'other']);
const SUPPORT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const SUPPORT_STATUSES = new Set(['open', 'in_progress', 'waiting', 'resolved', 'closed']);
const SUPPORT_SOURCES = new Set(['admin', 'owner', 'customer']);
const SUPPORT_AUTHORS = new Set(['admin', 'owner', 'cashier', 'customer']);

function uuid(value: unknown): string {
  const raw = text(value, 80);
  return UUID_RE.test(raw) ? raw : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface SupportGrant {
  role: 'owner' | 'admin';
  store_id: string | null;
}

async function loadGrant(db: SupabaseClient, token: string): Promise<SupportGrant | null> {
  if (token.length < 20) return null;
  const found = await db
    .from('support_access_grants')
    .select('role, store_id, expires_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle();
  if (found.error || !found.data) return null;
  if (Date.parse(String(found.data.expires_at)) <= Date.now()) return null;
  if (found.data.role !== 'admin' && found.data.role !== 'owner') return null;
  return {
    role: found.data.role,
    store_id: found.data.store_id ? String(found.data.store_id) : null,
  };
}

function ticketRow(value: unknown, storeId: string, allowAdmin: boolean): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = uuid(row.id);
  if (!id || !UUID_RE.test(storeId)) return null;
  const source = text(row.source, 20);
  const category = text(row.category, 20);
  const priority = text(row.priority, 20);
  const status = text(row.status, 20);
  if (!SUPPORT_SOURCES.has(source) || !SUPPORT_CATEGORIES.has(category) || !SUPPORT_PRIORITIES.has(priority) || !SUPPORT_STATUSES.has(status)) {
    return null;
  }
  if (source === 'admin' && !allowAdmin) return null;
  const now = new Date().toISOString();
  return {
    id,
    store_id: storeId,
    reference: text(row.reference, 40) || referenceFor(id),
    source,
    customer_name: text(row.customer_name, 120),
    customer_phone: text(row.customer_phone, 40),
    customer_email: text(row.customer_email, 160),
    category,
    priority,
    status,
    assignee_name: text(row.assignee_name, 120),
    subject: text(row.subject, 160) || 'Support request',
    opened_by_name: text(row.opened_by_name, 120),
    sla_first_response_due: text(row.sla_first_response_due, 40) || null,
    sla_resolution_due: text(row.sla_resolution_due, 40) || null,
    first_response_at: text(row.first_response_at, 40) || null,
    resolved_at: text(row.resolved_at, 40) || null,
    version: Math.max(1, Math.min(1_000_000, Number(row.version) || 1)),
    created_at: text(row.created_at, 40) || now,
    updated_at: text(row.updated_at, 40) || now,
  };
}

function messageRow(value: unknown, storeId: string, allowInternal: boolean): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = uuid(row.id);
  const ticketId = uuid(row.ticket_id);
  if (!id || !ticketId || !UUID_RE.test(storeId)) return null;
  const author = text(row.author_role, 20);
  if (!SUPPORT_AUTHORS.has(author)) return null;
  if (author === 'admin' && !allowInternal) return null;
  const visibility = row.visibility === 'internal' ? 'internal' : 'public';
  if (visibility === 'internal' && !allowInternal) return null;
  return {
    id,
    ticket_id: ticketId,
    store_id: storeId,
    author_role: author,
    author_name: text(row.author_name, 120),
    body: text(row.body, 4000),
    visibility,
    attachment_name: text(row.attachment_name, 160),
    attachment_data_url: text(row.attachment_data_url, 1_500_000),
    created_at: text(row.created_at, 40) || new Date().toISOString(),
  };
}

function replyRow(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = uuid(row.id);
  const title = text(row.title, 120);
  if (!id || !title) return null;
  return {
    id,
    title,
    body: text(row.body, 4000),
    updated_at: text(row.updated_at, 40) || new Date().toISOString(),
  };
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

    if (action === 'sync-pull' || action === 'sync-push') {
      const grant = await loadGrant(db, text(body.token, 200));
      if (!grant) {
        response.status(401).json({ error: 'Support session expired. Sign in again.' });
        return;
      }
      const requestedStore = uuid(body.storeId);
      const ownerStore = grant.store_id || '';
      if (grant.role === 'owner' && (!ownerStore || (requestedStore && requestedStore !== ownerStore))) {
        response.status(403).json({ error: 'This support session is for a different store.' });
        return;
      }

      if (action === 'sync-pull') {
        const storeId = grant.role === 'admin' ? requestedStore : ownerStore;
        let ticketQuery = db.from('support_tickets').select('*').order('updated_at', { ascending: false }).limit(400);
        if (storeId) ticketQuery = ticketQuery.eq('store_id', storeId);
        const tickets = await ticketQuery;
        if (tickets.error) throw new Error(tickets.error.message);
        const ids = (tickets.data || []).map((row) => String(row.id));
        let messages: Record<string, unknown>[] = [];
        for (let index = 0; index < ids.length; index += 100) {
          const chunk = ids.slice(index, index + 100);
          let messageQuery = db.from('support_messages').select('*').in('ticket_id', chunk);
          if (grant.role !== 'admin') messageQuery = messageQuery.neq('visibility', 'internal');
          const page = await messageQuery;
          if (page.error) throw new Error(page.error.message);
          messages = messages.concat((page.data || []) as Record<string, unknown>[]);
        }
        const replies = await db.from('support_canned_replies').select('*');
        if (replies.error) throw new Error(replies.error.message);
        response.status(200).json({ tickets: tickets.data || [], messages, replies: replies.data || [] });
        return;
      }

      const allowAdmin = grant.role === 'admin';
      const rawTickets = Array.isArray(body.tickets) ? body.tickets.slice(0, 100) : [];
      const rawMessages = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [];
      const rawReplies = Array.isArray(body.replies) ? body.replies.slice(0, 100) : [];
      const tickets = rawTickets
        .map((row) => {
          const record = asRecord(row);
          const targetStore = allowAdmin ? uuid(record?.store_id) : ownerStore;
          return targetStore ? ticketRow(row, targetStore, allowAdmin) : null;
        })
        .filter((row): row is Record<string, unknown> => row !== null);
      const ticketIds = new Set(tickets.map((row) => String(row.id)));
      const messageCandidates = rawMessages
        .map((row) => {
          const record = asRecord(row);
          const targetStore = allowAdmin ? uuid(record?.store_id) : ownerStore;
          return targetStore ? messageRow(row, targetStore, allowAdmin) : null;
        })
        .filter((row): row is Record<string, unknown> => row !== null);
      const unknownTicketIds = [...new Set(messageCandidates.map((row) => String(row.ticket_id)).filter((id) => !ticketIds.has(id)))];
      if (unknownTicketIds.length > 0) {
        const existing = await db.from('support_tickets').select('id, store_id').in('id', unknownTicketIds);
        if (existing.error) throw new Error(existing.error.message);
        for (const row of existing.data || []) {
          const rowStore = String(row.store_id);
          if (allowAdmin || rowStore === ownerStore) ticketIds.add(String(row.id));
        }
      }
      const messages = messageCandidates.filter((row) => ticketIds.has(String(row.ticket_id)));
      const replies = allowAdmin
        ? rawReplies.map(replyRow).filter((row): row is Record<string, unknown> => row !== null)
        : [];
      if (tickets.length > 0) {
        const saved = await db.from('support_tickets').upsert(tickets, { onConflict: 'id' });
        if (saved.error) throw new Error(saved.error.message);
      }
      if (messages.length > 0) {
        const saved = await db.from('support_messages').upsert(messages, { onConflict: 'id' });
        if (saved.error) throw new Error(saved.error.message);
      }
      if (replies.length > 0) {
        const saved = await db.from('support_canned_replies').upsert(replies, { onConflict: 'id' });
        if (saved.error) throw new Error(saved.error.message);
      }
      response.status(200).json({
        ticketIds: tickets.map((row) => String(row.id)),
        messageIds: messages.map((row) => String(row.id)),
        replyIds: replies.map((row) => String(row.id)),
      });
      return;
    }

    response.status(400).json({ error: 'Unknown customer care action.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Customer care request failed.';
    response.status(500).json({ error: message });
  }
}

import { db, type LocalStore, type LocalTransaction } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getSupportToken } from './access';
import type { LocalCannedReply, LocalSupportMessage, LocalSupportTicket } from './types';
import { notifyLocal } from './repository';

function lastWriteWins<T extends { updated_at: string; version: number }>(local: T, remote: T): T {
  const localTime = Date.parse(local.updated_at) || 0;
  const remoteTime = Date.parse(remote.updated_at) || 0;
  if (localTime !== remoteTime) return localTime > remoteTime ? local : remote;
  const localVersion = local.version || 0;
  const remoteVersion = remote.version || 0;
  if (localVersion !== remoteVersion) return localVersion > remoteVersion ? local : remote;
  return remote;
}

function ticketFromCloud(row: Record<string, unknown>): LocalSupportTicket {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    reference: String(row.reference || ''),
    source: (row.source as LocalSupportTicket['source']) || 'owner',
    customer_name: String(row.customer_name || ''),
    customer_phone: String(row.customer_phone || ''),
    customer_email: String(row.customer_email || ''),
    category: (row.category as LocalSupportTicket['category']) || 'other',
    priority: (row.priority as LocalSupportTicket['priority']) || 'normal',
    status: (row.status as LocalSupportTicket['status']) || 'open',
    assignee_name: String(row.assignee_name || ''),
    subject: String(row.subject || ''),
    opened_by_name: String(row.opened_by_name || ''),
    sla_first_response_due: String(row.sla_first_response_due || row.created_at || ''),
    sla_resolution_due: String(row.sla_resolution_due || row.created_at || ''),
    first_response_at: row.first_response_at ? String(row.first_response_at) : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
    version: Number(row.version) || 1,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || row.created_at || ''),
    synced: 1,
  };
}

function messageFromCloud(row: Record<string, unknown>): LocalSupportMessage {
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    store_id: String(row.store_id),
    author_role: (row.author_role as LocalSupportMessage['author_role']) || 'customer',
    author_name: String(row.author_name || ''),
    body: String(row.body || ''),
    visibility: row.visibility === 'internal' ? 'internal' : 'public',
    attachment_name: String(row.attachment_name || ''),
    attachment_data_url: String(row.attachment_data_url || ''),
    created_at: String(row.created_at || ''),
    synced: 1,
  };
}

function toCloudTicket(ticket: LocalSupportTicket): Record<string, unknown> {
  const { synced: _synced, ...rest } = ticket;
  return rest;
}

type CareResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unavailable' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string };

async function postCare<T>(body: Record<string, unknown>): Promise<CareResult<T>> {
  try {
    const response = await fetch('/api/customer-care', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 404) return { kind: 'unavailable' };
    const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
    if (response.status === 401) return { kind: 'unauthorized' };
    if (!response.ok) {
      const message = typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : 'Help & Support sync failed.';
      if (/unknown customer care action/i.test(message)) return { kind: 'unavailable' };
      return { kind: 'error', message };
    }
    return { kind: 'ok', data: payload };
  } catch {
    return { kind: 'unavailable' };
  }
}

function quietSchemaError(message: string): boolean {
  return /does not exist|schema cache|PGRST205/i.test(message);
}

export async function pushSupportChanges(storeId: string): Promise<{ pushed: number; error?: string }> {
  if (!isSupabaseConfigured()) return { pushed: 0 };
  const tickets = await db.support_tickets.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  const messages = await db.support_messages.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  const replies = await db.support_canned_replies.filter((row) => row.synced === 0).toArray();
  const token = getSupportToken();
  if (token && (tickets.length > 0 || messages.length > 0 || replies.length > 0)) {
    const api = await postCare<{ ticketIds?: unknown; messageIds?: unknown; replyIds?: unknown }>({
      action: 'sync-push',
      token,
      storeId,
      tickets: tickets.map((ticket) => toCloudTicket(ticket)),
      messages: messages.map((message) => {
        const { synced: _synced, ...rest } = message;
        return rest;
      }),
      replies: replies.map((reply) => ({ id: reply.id, title: reply.title, body: reply.body, updated_at: reply.updated_at })),
    });
    if (api.kind === 'ok') {
      const ticketIds = new Set(Array.isArray(api.data.ticketIds) ? api.data.ticketIds.map(String) : []);
      const messageIds = new Set(Array.isArray(api.data.messageIds) ? api.data.messageIds.map(String) : []);
      const replyIds = new Set(Array.isArray(api.data.replyIds) ? api.data.replyIds.map(String) : []);
      await Promise.all([
        ...tickets.filter((ticket) => ticketIds.has(ticket.id)).map((ticket) => db.support_tickets.update(ticket.id, { synced: 1 })),
        ...messages.filter((message) => messageIds.has(message.id)).map((message) => db.support_messages.update(message.id, { synced: 1 })),
        ...replies.filter((reply) => replyIds.has(reply.id)).map((reply) => db.support_canned_replies.update(reply.id, { synced: 1 })),
      ]);
      return { pushed: ticketIds.size + messageIds.size + replyIds.size };
    }
    if (api.kind === 'error') {
      if (quietSchemaError(api.message)) return { pushed: 0 };
      return { pushed: 0, error: `Help & Support: ${api.message}` };
    }
  }
  let pushed = 0;
  if (tickets.length > 0) {
    const { error } = await supabase.from('support_tickets').upsert(
      tickets.map((ticket) => toCloudTicket(ticket)),
      { onConflict: 'id' }
    );
    if (error) {
      if (/does not exist|schema cache|PGRST205|permission denied for function/i.test(error.message)) return { pushed: 0 };
      return { pushed: 0, error: `Help & Support: ${error.message}` };
    }
    await Promise.all(tickets.map((ticket) => db.support_tickets.update(ticket.id, { synced: 1 })));
    pushed += tickets.length;
  }
  if (messages.length > 0) {
    const { error } = await supabase.from('support_messages').upsert(
      messages.map((message) => {
        const { synced: _synced, ...rest } = message;
        return rest;
      }),
      { onConflict: 'id' }
    );
    if (error) {
      if (/does not exist|schema cache|PGRST205|permission denied for function/i.test(error.message)) return { pushed };
      return { pushed, error: `Help & Support messages: ${error.message}` };
    }
    await Promise.all(messages.map((message) => db.support_messages.update(message.id, { synced: 1 })));
    pushed += messages.length;
  }
  if (replies.length > 0) {
    const { error } = await supabase.from('support_canned_replies').upsert(
      replies.map((reply) => ({ id: reply.id, title: reply.title, body: reply.body, updated_at: reply.updated_at })),
      { onConflict: 'id' }
    );
    if (!error) {
      await Promise.all(replies.map((reply) => db.support_canned_replies.update(reply.id, { synced: 1 })));
      pushed += replies.length;
    }
  }
  return { pushed };
}

async function mergeTicket(remote: LocalSupportTicket): Promise<void> {
  const local = await db.support_tickets.get(remote.id);
  if (!local) {
    await db.support_tickets.put(remote);
    return;
  }
  if (local.synced === 0) {
    const winner = lastWriteWins(local, remote);
    await db.support_tickets.put({ ...winner, synced: winner === local ? 0 : 1 });
    return;
  }
  await db.support_tickets.put(remote);
}

async function applySupportPull(tickets: Record<string, unknown>[], messages: Record<string, unknown>[], replies: Record<string, unknown>[]): Promise<void> {
  const remoteTickets = tickets.map(ticketFromCloud);
  for (const ticket of remoteTickets) {
    const before = await db.support_tickets.get(ticket.id);
    await mergeTicket(ticket);
    if (!before) {
      await notifyLocal({
        storeId: ticket.store_id,
        ticketId: ticket.id,
        title: `Ticket ${ticket.reference}`,
        body: ticket.subject,
      });
    }
  }
  for (const row of messages) {
    const message = messageFromCloud(row);
    const existing = await db.support_messages.get(message.id);
    if (!existing) {
      await db.support_messages.put(message);
      if (message.author_role === 'admin' && message.visibility === 'public') {
        await notifyLocal({
          storeId: message.store_id,
          ticketId: message.ticket_id,
          title: 'Customer care replied',
          body: message.body.slice(0, 140),
        });
      }
    }
  }
  for (const row of replies) {
    const reply: LocalCannedReply = {
      id: String(row.id),
      title: String(row.title || ''),
      body: String(row.body || ''),
      updated_at: String(row.updated_at || ''),
      synced: 1,
    };
    const local = await db.support_canned_replies.get(reply.id);
    if (!local || local.synced !== 0) await db.support_canned_replies.put(reply);
  }
}

export async function pullSupportChanges(storeId: string | null): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const token = getSupportToken();
  if (token) {
    const api = await postCare<{ tickets?: unknown; messages?: unknown; replies?: unknown }>({
      action: 'sync-pull',
      token,
      storeId,
    });
    if (api.kind === 'ok') {
      const tickets = Array.isArray(api.data.tickets) ? api.data.tickets as Record<string, unknown>[] : [];
      const messages = Array.isArray(api.data.messages) ? api.data.messages as Record<string, unknown>[] : [];
      const replies = Array.isArray(api.data.replies) ? api.data.replies as Record<string, unknown>[] : [];
      await applySupportPull(tickets, messages, replies);
      return null;
    }
    if (api.kind === 'unauthorized') return null;
    if (api.kind === 'error') {
      if (quietSchemaError(api.message)) return null;
      return api.message;
    }
  } else {
    return null;
  }
  let ticketQuery = supabase.from('support_tickets').select('*');
  if (storeId) ticketQuery = ticketQuery.eq('store_id', storeId);
  const tickets = await ticketQuery;
  if (tickets.error) {
    if (/does not exist|schema cache|PGRST205|row-level security|42501|permission denied for function/i.test(tickets.error.message)) return null;
    return tickets.error.message;
  }
  const remoteTickets = ((tickets.data || []) as Record<string, unknown>[]).map(ticketFromCloud);
  for (const ticket of remoteTickets) {
    const before = await db.support_tickets.get(ticket.id);
    await mergeTicket(ticket);
    if (!before) {
      await notifyLocal({
        storeId: ticket.store_id,
        ticketId: ticket.id,
        title: `Ticket ${ticket.reference}`,
        body: ticket.subject,
      });
    }
  }
  const ids = remoteTickets.map((ticket) => ticket.id);
  if (ids.length === 0) return null;
  const messages = await supabase.from('support_messages').select('*').in('ticket_id', ids);
  if (messages.error || !messages.data) return null;
  for (const row of messages.data as Record<string, unknown>[]) {
    const message = messageFromCloud(row);
    const existing = await db.support_messages.get(message.id);
    if (!existing) {
      await db.support_messages.put(message);
      if (message.author_role === 'admin' && message.visibility === 'public') {
        await notifyLocal({
          storeId: message.store_id,
          ticketId: message.ticket_id,
          title: 'Customer care replied',
          body: message.body.slice(0, 140),
        });
      }
    }
  }
  const canned = await supabase.from('support_canned_replies').select('*');
  if (!canned.error && canned.data) {
    for (const row of canned.data as Record<string, unknown>[]) {
      const reply: LocalCannedReply = {
        id: String(row.id),
        title: String(row.title || ''),
        body: String(row.body || ''),
        updated_at: String(row.updated_at || ''),
        synced: 1,
      };
      const local = await db.support_canned_replies.get(reply.id);
      if (!local || local.synced !== 0) await db.support_canned_replies.put(reply);
    }
  }
  return null;
}

export async function storeProfile(storeId: string): Promise<{
  store: LocalStore | null;
  recent: LocalTransaction[];
}> {
  const store = (await db.stores.get(storeId)) || null;
  const recent = (await db.transactions.where('store_id').equals(storeId).toArray())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  return { store, recent };
}

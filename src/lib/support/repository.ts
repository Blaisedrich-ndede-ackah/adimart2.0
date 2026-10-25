import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/dexie';
import { slaDueDates } from './sla';
import type {
  LocalCannedReply,
  LocalSupportMessage,
  LocalSupportNotification,
  LocalSupportTicket,
  SupportAuthorRole,
  SupportCategory,
  SupportPriority,
  SupportSource,
  SupportStatus,
  SupportVisibility,
} from './types';

const CANNED_DEFAULTS: Array<Pick<LocalCannedReply, 'title' | 'body'>> = [
  {
    title: 'Greeting',
    body: 'Hello, this is Adimat customer care. We have your request and will reply shortly.',
  },
  {
    title: 'Ask for receipt',
    body: 'Please send the receipt number and the phone number on the sale so we can look it up.',
  },
  {
    title: 'Subscription help',
    body: 'Your plan screen shows the renewal amount. Reply here if Paystack did not activate the store.',
  },
  {
    title: 'Resolved',
    body: 'We have resolved this request. Reply on this ticket if anything is still wrong.',
  },
];

export function supportReference(id: string): string {
  return `CARE-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export async function ensureCannedReplies(): Promise<void> {
  const existing = await db.support_canned_replies.count();
  if (existing > 0) return;
  const now = new Date().toISOString();
  await db.support_canned_replies.bulkAdd(
    CANNED_DEFAULTS.map((reply) => ({
      id: uuidv4(),
      title: reply.title,
      body: reply.body,
      updated_at: now,
      synced: 0,
    }))
  );
}

export async function listTickets(storeId?: string | null): Promise<LocalSupportTicket[]> {
  const rows = storeId
    ? await db.support_tickets.where('store_id').equals(storeId).toArray()
    : await db.support_tickets.toArray();
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function listMessages(ticketId: string, includeInternal: boolean): Promise<LocalSupportMessage[]> {
  const rows = await db.support_messages.where('ticket_id').equals(ticketId).toArray();
  return rows
    .filter((row) => includeInternal || row.visibility !== 'internal')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function createTicket(input: {
  storeId: string;
  source: SupportSource;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  category: SupportCategory;
  priority: SupportPriority;
  subject: string;
  body: string;
  openedByName: string;
  authorRole: SupportAuthorRole;
  attachmentName?: string;
  attachmentDataUrl?: string;
}): Promise<LocalSupportTicket> {
  const now = new Date().toISOString();
  const id = uuidv4();
  const due = slaDueDates(input.priority, now);
  const ticket: LocalSupportTicket = {
    id,
    store_id: input.storeId,
    reference: supportReference(id),
    source: input.source,
    customer_name: input.customerName.trim(),
    customer_phone: input.customerPhone.trim(),
    customer_email: input.customerEmail.trim(),
    category: input.category,
    priority: input.priority,
    status: 'open',
    assignee_name: '',
    subject: input.subject.trim(),
    opened_by_name: input.openedByName.trim(),
    ...due,
    first_response_at: null,
    resolved_at: null,
    version: 1,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  const message: LocalSupportMessage = {
    id: uuidv4(),
    ticket_id: id,
    store_id: input.storeId,
    author_role: input.authorRole,
    author_name: input.openedByName.trim() || 'Customer',
    body: input.body.trim(),
    visibility: 'public',
    attachment_name: input.attachmentName || '',
    attachment_data_url: input.attachmentDataUrl || '',
    created_at: now,
    synced: 0,
  };
  await db.support_tickets.add(ticket);
  await db.support_messages.add(message);
  return ticket;
}

export async function addMessage(input: {
  ticket: LocalSupportTicket;
  authorRole: SupportAuthorRole;
  authorName: string;
  body: string;
  visibility: SupportVisibility;
  attachmentName?: string;
  attachmentDataUrl?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await db.support_messages.add({
    id: uuidv4(),
    ticket_id: input.ticket.id,
    store_id: input.ticket.store_id,
    author_role: input.authorRole,
    author_name: input.authorName.trim() || 'Staff',
    body: input.body.trim(),
    visibility: input.visibility,
    attachment_name: input.attachmentName || '',
    attachment_data_url: input.attachmentDataUrl || '',
    created_at: now,
    synced: 0,
  });
  const patch: Partial<LocalSupportTicket> = {
    updated_at: now,
    version: (input.ticket.version || 1) + 1,
    synced: 0,
  };
  if (input.visibility === 'public' && input.authorRole === 'admin' && !input.ticket.first_response_at) {
    patch.first_response_at = now;
    if (input.ticket.status === 'open') patch.status = 'in_progress';
  }
  await db.support_tickets.update(input.ticket.id, patch);
}

export async function updateTicket(
  ticket: LocalSupportTicket,
  patch: Partial<Pick<LocalSupportTicket, 'status' | 'priority' | 'category' | 'assignee_name' | 'subject'>>
): Promise<void> {
  const now = new Date().toISOString();
  const next: Partial<LocalSupportTicket> = {
    ...patch,
    updated_at: now,
    version: (ticket.version || 1) + 1,
    synced: 0,
  };
  if ((patch.status === 'resolved' || patch.status === 'closed') && !ticket.resolved_at) {
    next.resolved_at = now;
  }
  if (patch.status && patch.status !== 'resolved' && patch.status !== 'closed') {
    next.resolved_at = null;
  }
  await db.support_tickets.update(ticket.id, next);
}

export async function notifyLocal(input: {
  storeId: string;
  ticketId: string;
  title: string;
  body: string;
}): Promise<void> {
  await db.support_notifications.add({
    id: uuidv4(),
    store_id: input.storeId,
    ticket_id: input.ticketId,
    title: input.title,
    body: input.body,
    created_at: new Date().toISOString(),
    read: 0,
  });
}

export async function listNotifications(storeId: string): Promise<LocalSupportNotification[]> {
  const rows = await db.support_notifications.where('store_id').equals(storeId).toArray();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
}

export async function markNotificationsRead(storeId: string): Promise<void> {
  const rows = await db.support_notifications.where('store_id').equals(storeId).toArray();
  await Promise.all(rows.filter((row) => row.read === 0).map((row) => db.support_notifications.update(row.id, { read: 1 })));
}

export function readAttachmentFile(file: File, maxChars = 280_000): Promise<{ name: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    if (file.size > 200_000) {
      reject(new Error('Attachment must be 200 KB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the attachment.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl.length > maxChars) {
        reject(new Error('Attachment is too large to store on this device.'));
        return;
      }
      resolve({ name: file.name.slice(0, 120), dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

export function statusLabel(status: SupportStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'waiting':
      return 'Waiting';
    case 'resolved':
      return 'Resolved';
    case 'closed':
      return 'Closed';
    default:
      return 'Open';
  }
}

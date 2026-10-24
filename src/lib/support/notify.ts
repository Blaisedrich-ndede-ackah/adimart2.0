import { sendSmsViaMnotify } from '@/lib/mnotify';
import { loadPlatformSettings } from '@/lib/platformSettings';
import { db } from '@/lib/dexie';
import { notifyLocal } from './repository';
import type { LocalSupportTicket } from './types';

function alreadySent(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Private mode can block localStorage. The in-app notice still shows.
  }
}

export async function notifyNewTicket(ticket: LocalSupportTicket): Promise<void> {
  await notifyLocal({
    storeId: ticket.store_id,
    ticketId: ticket.id,
    title: `New ticket ${ticket.reference}`,
    body: ticket.subject,
  });
  const key = `adimat_care_sms_new_${ticket.id}`;
  if (alreadySent(key)) return;
  const settings = await loadPlatformSettings();
  const recipient = settings.contact_whatsapp.trim();
  if (!recipient) return;
  const result = await sendSmsViaMnotify(
    recipient,
    `Adimat care: ${ticket.reference} ${ticket.subject}`.slice(0, 160)
  );
  if (result.success || result.skipped) remember(key);
}

export async function notifyTicketReply(ticket: LocalSupportTicket, body: string, toCustomer: boolean): Promise<void> {
  await notifyLocal({
    storeId: ticket.store_id,
    ticketId: ticket.id,
    title: `Reply on ${ticket.reference}`,
    body: body.slice(0, 140),
  });
  if (!toCustomer) return;
  const key = `adimat_care_sms_reply_${ticket.id}_${ticket.updated_at}`;
  if (alreadySent(key)) return;
  const store = await db.stores.get(ticket.store_id);
  const recipient = ticket.customer_phone.trim() || store?.support_number || '';
  if (!recipient) return;
  const result = await sendSmsViaMnotify(
    recipient,
    `Adimat care ${ticket.reference}: ${body}`.slice(0, 160)
  );
  if (result.success || result.skipped) remember(key);
}

/**
 * Store-owner bulk SMS campaigns.
 * Sends one promotional message to every registered customer of the
 * signed-in store via the configured mNotify API key.
 */

import { db, generateId, getCurrentStore, getCurrentStoreCustomers, getCurrentStoreId, type LocalBulkSmsCampaign } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { sendBulkSmsViaMnotify, normalizeRecipientList, type BulkSmsResult } from '@/lib/mnotify';

export interface BulkSmsCampaignInput {
  message: string;
}

export interface BulkSmsSendResult extends BulkSmsResult {
  campaign?: LocalBulkSmsCampaign;
  recipientCount: number;
}

/** Maximum characters per SMS message body (GSM-7 safe default). */
export const BULK_SMS_MAX_CHARS = 460;

function validateMessage(message: string): string | null {
  const text = (message || '').trim();
  if (!text) return 'Enter a message to send.';
  if (text.length > BULK_SMS_MAX_CHARS) {
    return `Message is too long. Keep it under ${BULK_SMS_MAX_CHARS} characters.`;
  }
  return null;
}

/**
 * Send a bulk SMS to every registered customer of the current store.
 * Records an audit row locally and pushes it to the cloud on the next sync.
 * Safe to call offline — it only sends when mNotify is configured.
 */
export async function sendBulkSmsToCurrentStoreCustomers(
  input: BulkSmsCampaignInput
): Promise<BulkSmsSendResult> {
  const messageError = validateMessage(input.message);
  if (messageError) {
    return {
      success: false,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'failed',
      error: messageError,
    };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return {
      success: false,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'failed',
      error: 'No store selected.',
    };
  }

  const customers = await getCurrentStoreCustomers();
  const phones = normalizeRecipientList(customers.map((customer) => customer.phone || ''));
  if (phones.length === 0) {
    return {
      success: false,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'failed',
      error: 'No registered customer has a phone number on file.',
    };
  }

  const message = input.message.trim();
  const result = await sendBulkSmsViaMnotify(phones, message);

  const campaign: LocalBulkSmsCampaign = {
    id: generateId(),
    store_id: storeId,
    message,
    recipient_count: result.recipientCount,
    sent_count: result.sentCount,
    failed_count: result.failedCount,
    provider: 'mnotify',
    provider_message_id: result.providerMessageId,
    status: result.status,
    error_message: result.error,
    created_at: new Date().toISOString(),
    synced: 0,
  };

  await db.bulk_sms_campaigns.add(campaign);

  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('bulk_sms_campaigns').insert({
        id: campaign.id,
        store_id: campaign.store_id,
        message: campaign.message,
        recipient_count: campaign.recipient_count,
        sent_count: campaign.sent_count,
        failed_count: campaign.failed_count,
        provider: campaign.provider,
        provider_message_id: campaign.provider_message_id || null,
        status: campaign.status,
        error_message: campaign.error_message || null,
        created_at: campaign.created_at,
      });
      if (!error) {
        await db.bulk_sms_campaigns.update(campaign.id, { synced: 1 });
      }
    } catch {
      // Will retry on next sync
    }
  }

  return { ...result, campaign };
}

/** List bulk SMS campaigns for the current store, newest first. */
export async function getCurrentStoreBulkSmsCampaigns(): Promise<LocalBulkSmsCampaign[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.bulk_sms_campaigns.where('store_id').equals(storeId).sortBy('created_at').then((rows) =>
    rows.reverse()
  );
}

/** Count registered customers with a phone number for the current store. */
export async function countCurrentStoreCustomerRecipients(): Promise<number> {
  const customers = await getCurrentStoreCustomers();
  return normalizeRecipientList(customers.map((customer) => customer.phone || '')).length;
}

export async function getCurrentStoreForBulkSms(): Promise<{
  id: string;
  name: string;
  support_number: string;
} | null> {
  const store = await getCurrentStore();
  if (!store) return null;
  return { id: store.id, name: store.name, support_number: store.support_number || '' };
}
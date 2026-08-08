/**
 * Fire mNotify SMS when a store's subscription is nearing expiry.
 * Called from the authenticated app shell; deduped in mnotify.ts.
 */

import { getCurrentStore } from './dexie';
import { getSubscriptionInfo } from './subscription';
import { notifySubscriptionExpiringSoon, resolveStoreOwnerPhone } from './mnotify';

export async function checkAndSendSubscriptionExpirySms(): Promise<void> {
  const store = await getCurrentStore();
  if (!store?.subscription_expires_at) return;

  const info = getSubscriptionInfo(store.subscription_expires_at, store.subscription_started_at);
  if (!info.isExpiringSoon || !info.expiresAt || info.daysLeft == null) return;

  const phone = resolveStoreOwnerPhone(store);
  if (!phone) return;

  await notifySubscriptionExpiringSoon({
    storeId: store.id,
    storeName: store.name || 'your store',
    ownerPhone: phone,
    expiresAt: info.expiresAt,
    daysLeft: info.daysLeft,
  });
}

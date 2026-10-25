import type { AdminStoreRow, AdminUserRow } from '@/lib/adminPortal';

export interface BroadcastRecipient {
  store: AdminStoreRow;
  owner: AdminUserRow;
}

/** Active store owners who have a phone number, one owner per store. */
export function listBroadcastRecipients(
  stores: AdminStoreRow[],
  users: AdminUserRow[]
): BroadcastRecipient[] {
  const ownerByStore = new Map<string, AdminUserRow>();
  users
    .filter((user) => user.role === 'owner' && user.is_active && user.phone.trim())
    .forEach((user) => ownerByStore.set(user.store_id, user));
  return stores
    .filter((store) => ownerByStore.has(store.id))
    .map((store) => ({ store, owner: ownerByStore.get(store.id)! }));
}

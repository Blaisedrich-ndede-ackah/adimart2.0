import { describe, expect, it } from 'vitest';
import { listBroadcastRecipients } from './adminBroadcast';
import type { AdminStoreRow, AdminUserRow } from './adminPortal';

function store(id: string, name: string): AdminStoreRow {
  return {
    id,
    name,
    address: '',
    support_number: '',
    momo_account_name: '',
    momo_number: '',
    momo_network: '',
    subscription_started_at: null,
    subscription_expires_at: null,
    subscription_months_granted: 0,
    access_blocked: false,
    warehouse_enabled: false,
    max_shops: 1,
    max_warehouses: 0,
    max_stores: 1,
    ecommerce_enabled: false,
    ecommerce_slug: '',
    created_at: '',
    transactions_cleared_at: null,
  };
}

function user(partial: Partial<AdminUserRow> & Pick<AdminUserRow, 'id' | 'store_id' | 'role' | 'phone'>): AdminUserRow {
  return {
    name: 'Owner',
    is_active: true,
    created_at: '',
    ...partial,
  };
}

describe('listBroadcastRecipients', () => {
  it('keeps one active owner with a phone for each store', () => {
    const recipients = listBroadcastRecipients(
      [store('s1', 'Accra'), store('s2', 'Kumasi')],
      [
        user({ id: 'u1', store_id: 's1', role: 'owner', phone: '0244000001', name: 'Ama' }),
        user({ id: 'u2', store_id: 's1', role: 'cashier', phone: '0244000002', name: 'Kofi' }),
        user({ id: 'u3', store_id: 's2', role: 'owner', phone: '  ', name: 'Esi' }),
        user({ id: 'u4', store_id: 's2', role: 'owner', phone: '0244000004', name: 'Yaw', is_active: false }),
      ]
    );
    expect(recipients.map((row) => row.owner.name)).toEqual(['Ama']);
    expect(recipients[0]?.store.name).toBe('Accra');
  });
});

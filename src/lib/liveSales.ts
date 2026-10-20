/**
 * Live sales feed for the owner dashboard.
 *
 * When Supabase is configured the owner dashboard subscribes to the
 * `transactions` table so a sale made on any till (or phone) shows up on
 * the owner's screen straight away. Without a cloud connection the
 * dashboard falls back to its regular refresh timer.
 */

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface LiveSaleEvent {
  id: string;
  receiptNumber: string;
  totalAmount: number;
  paymentMethod: string;
  cashierName: string;
  createdAt: string;
}

export type LiveSalesStatus = 'connecting' | 'live' | 'offline';

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback;
}

function mapSaleRow(row: Record<string, unknown>): LiveSaleEvent {
  const status = row.status;
  return {
    id: toText(row.id),
    receiptNumber: toText(row.receipt_number),
    totalAmount: toNumber(row.total_amount),
    paymentMethod: toText(row.payment_method),
    cashierName: toText(row.cashier_name),
    createdAt: toText(row.created_at, new Date().toISOString()),
  };
}

/**
 * Subscribe to new sales for one store.
 *
 * Returns an unsubscribe function. The callback receives the sale that was
 * just completed. The status callback reports whether the live feed is
 * connected so the UI can show an honest "Live" or "Offline" badge.
 */
export function subscribeToStoreSales(
  storeId: string,
  onSale: (sale: LiveSaleEvent) => void,
  onStatus?: (status: LiveSalesStatus) => void
): () => void {
  if (!isSupabaseConfigured() || !storeId) {
    onStatus?.('offline');
    return () => undefined;
  }

  const channel = supabase
    .channel(`adimat-sales-${storeId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'transactions', filter: `store_id=eq.${storeId}` },
      (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        const status = row.status;
        if (typeof status !== 'string' || status !== 'completed') return;
        onSale(mapSaleRow(row));
      }
    )
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') onStatus?.('live');
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        onStatus?.('offline');
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

import { useEffect, useRef, useState } from 'react';
import {
  subscribeToStoreSales,
  type LiveSaleEvent,
  type LiveSalesStatus,
} from '@/lib/liveSales';

export interface UseLiveStoreSalesResult {
  /** 'live' while the realtime feed is connected, 'offline' otherwise. */
  status: LiveSalesStatus;
  /** The most recent sale seen on the live feed. */
  lastSale: LiveSaleEvent | null;
}

/**
 * Keep a screen in step with sales happening on other devices.
 *
 * Uses the Supabase realtime feed when the cloud is configured and always
 * keeps a slow polling fallback so the dashboard still refreshes on a
 * device that is offline or on a network that blocks websockets.
 */
export function useLiveStoreSales(
  storeId: string | null | undefined,
  onSale: (sale: LiveSaleEvent) => void,
  onRefresh?: () => void,
  pollIntervalMs = 30_000
): UseLiveStoreSalesResult {
  const [status, setStatus] = useState<LiveSalesStatus>('offline');
  const [lastSale, setLastSale] = useState<LiveSaleEvent | null>(null);
  const saleHandlerRef = useRef(onSale);
  const refreshHandlerRef = useRef(onRefresh);
  saleHandlerRef.current = onSale;
  refreshHandlerRef.current = onRefresh;

  useEffect(() => {
    if (!storeId) {
      setStatus('offline');
      return;
    }

    const unsubscribe = subscribeToStoreSales(
      storeId,
      (sale) => {
        setLastSale(sale);
        saleHandlerRef.current(sale);
      },
      setStatus
    );

    const timer = window.setInterval(() => {
      refreshHandlerRef.current?.();
    }, pollIntervalMs);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [storeId, pollIntervalMs]);

  return { status, lastSale };
}

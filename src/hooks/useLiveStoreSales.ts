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
 * Uses Supabase Realtime while connected and polls only when the browser or
 * realtime feed is offline, so local data still refreshes without the cloud.
 */
export function useLiveStoreSales(
  storeId: string | null | undefined,
  onSale: (sale: LiveSaleEvent) => void,
  onRefresh?: () => void | Promise<void>,
  pollIntervalMs = 30_000
): UseLiveStoreSalesResult {
  const [status, setStatus] = useState<LiveSalesStatus>('offline');
  const [lastSale, setLastSale] = useState<LiveSaleEvent | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
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

    return () => {
      unsubscribe();
    };
  }, [storeId]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!storeId || !visible || (online && status !== 'offline')) return;
    let active = true;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        try {
          await refreshHandlerRef.current?.();
        } catch (error) {
          console.warn('[Live sales] Offline refresh failed:', error);
        }
        if (active) schedule();
      }, pollIntervalMs);
    };
    schedule();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [storeId, online, status, visible, pollIntervalMs]);

  return { status, lastSale };
}

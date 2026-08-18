export type StockChange = {
  productId: string;
  /** Absolute qty at the sale location after the change (if known) */
  locationQty?: number;
  /** Absolute product.stock_level after the change (this store's shop) */
  totalQty?: number;
  /** Units removed from the location (positive = deducted) */
  deducted?: number;
};

export type StockChangedEvent = {
  storeId: string;
  locationId?: string | null;
  reason: 'sale' | 'adjust' | 'order' | 'receive' | 'sync';
  changes: StockChange[];
  at: number;
};

type Listener = (event: StockChangedEvent) => void;

const listeners = new Set<Listener>();

export function subscribeStockChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitStockChanged(event: Omit<StockChangedEvent, 'at'>): void {
  const payload: StockChangedEvent = { ...event, at: Date.now() };
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // Ignore listener errors so UI updates never break checkout
    }
  });
}

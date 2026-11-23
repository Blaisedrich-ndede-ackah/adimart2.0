import { useEffect } from 'react';

export const CFD_CHANNEL_NAME = 'adimat-pos-cfd';
const CFD_SETTINGS_KEY = 'adimat_customer_display_enabled';

export interface CfdCartItem {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  image_url?: string;
}

export interface CfdReceiptPayload {
  receiptNumber: string;
  token: string;
  qrPayload: string;
  expiresAt: string;
}

export type CfdMessage =
  | {
      type: 'CartUpdated';
      payload: {
        items: CfdCartItem[];
        subtotal: number;
        total: number;
        itemCount: number;
        currency: string;
      };
    }
  | { type: 'PaymentStarted' }
  | { type: 'PaymentSuccess'; payload?: CfdReceiptPayload }
  | { type: 'PaymentFailed' }
  | { type: 'Reset' }
  | { type: 'SetMessage'; payload: { message: string } }
  | { type: 'DisplayReady' };

export function broadcastCfdMessage(message: CfdMessage): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CFD_CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Customer display is an optional enhancement; unsupported browsers no-op.
  }
}

export function useCustomerDisplayChannel(onMessage: (message: CfdMessage) => void): void {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(CFD_CHANNEL_NAME);
    } catch {
      return;
    }
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isCfdMessage(event.data)) return;
      onMessage(event.data);
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [onMessage]);
}

function isCfdMessage(value: unknown): value is CfdMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const message = value as { type?: unknown; payload?: unknown };
  switch (message.type) {
    case 'PaymentStarted':
    case 'PaymentFailed':
    case 'Reset':
    case 'DisplayReady':
      return true;
    case 'PaymentSuccess': {
      if (message.payload === undefined) return true;
      if (!message.payload || typeof message.payload !== 'object') return false;
      const payload = message.payload as Record<string, unknown>;
      return typeof payload.receiptNumber === 'string' && typeof payload.token === 'string' &&
        typeof payload.qrPayload === 'string' && typeof payload.expiresAt === 'string';
    }
    case 'SetMessage':
      return typeof message.payload === 'object' && message.payload !== null &&
        'message' in message.payload && typeof message.payload.message === 'string';
    case 'CartUpdated': {
      if (!message.payload || typeof message.payload !== 'object') return false;
      const payload = message.payload as Record<string, unknown>;
      return Array.isArray(payload.items) && typeof payload.subtotal === 'number' &&
        typeof payload.total === 'number' && typeof payload.itemCount === 'number' &&
        typeof payload.currency === 'string';
    }
    default:
      return false;
  }
}

export function isCustomerDisplayEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(CFD_SETTINGS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCustomerDisplayEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(CFD_SETTINGS_KEY, String(enabled));
  } catch {
    // Keep settings usable when storage is unavailable.
  }
}

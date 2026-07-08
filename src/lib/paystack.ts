const PAYSTACK_PUBLIC_KEY = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '').trim().replace(/^["']|["']$/g, '');

const PAYSTACK_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export function isPaystackConfigured(): boolean {
  return PAYSTACK_PUBLIC_KEY.length > 0 && PAYSTACK_PUBLIC_KEY.startsWith('pk_');
}

export function isValidPaystackEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!PAYSTACK_EMAIL_REGEX.test(trimmed)) return false;

  const domain = trimmed.split('@')[1]?.toLowerCase() ?? '';
  // Paystack rejects uncommon TLDs like .pos that are not in most email validators.
  if (domain.endsWith('.pos') || domain.endsWith('.local') || domain.endsWith('.test')) {
    return false;
  }

  return true;
}

export function resolvePaystackEmail(
  preferredEmail?: string,
  reference?: string
): string {
  if (preferredEmail && isValidPaystackEmail(preferredEmail)) {
    return preferredEmail.trim();
  }

  const suffix = (reference || Date.now().toString(36)).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `customer+${suffix}@adimatpos.com`;
}

export function generatePaystackReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ADM-${timestamp}-${random}`.toUpperCase();
}

interface PaystackConfig {
  email: string;
  amount: number; // in pesewas (GHS * 100)
  reference: string;
  onSuccess: (reference: string) => void;
  onClose: () => void;
  metadata?: Record<string, unknown>;
}

// Load Paystack script dynamically
function loadPaystackScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('paystack-script')) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = 'paystack-script';
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paystack script'));
    document.head.appendChild(script);
  });
}

export async function initializePaystack(config: PaystackConfig): Promise<void> {
  if (!isPaystackConfigured()) {
    throw new Error('Paystack not configured. Add VITE_PAYSTACK_PUBLIC_KEY to environment variables.');
  }

  const email = resolvePaystackEmail(config.email, config.reference);
  if (!isValidPaystackEmail(email)) {
    throw new Error('A valid customer email is required for Paystack payments.');
  }

  try {
    await loadPaystackScript();

    const PaystackPop = (window as unknown as { PaystackPop: { setup: (opts: Record<string, unknown>) => { openIframe: () => void } } }).PaystackPop;

    if (!PaystackPop) {
      throw new Error('Paystack script loaded but PaystackPop not available');
    }

    const handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round(config.amount), // Amount in pesewas
      currency: 'GHS',
      ref: config.reference,
      channels: ['mobile_money', 'card', 'bank', 'ussd', 'qr'],
      metadata: {
        custom_fields: [
          {
            display_name: 'Payment For',
            variable_name: 'payment_for',
            value: 'POS Sale',
          },
          ...(config.metadata ? Object.entries(config.metadata).map(([key, value]) => ({
            display_name: key,
            variable_name: key.toLowerCase().replace(/\s/g, '_'),
            value: String(value),
          })) : []),
        ],
      },
      callback: (response: { reference: string; status: string; message: string }) => {
        if (response.status === 'success') {
          config.onSuccess(response.reference);
        } else {
          config.onClose();
        }
      },
      onClose: () => {
        config.onClose();
      },
    });

    handler.openIframe();
  } catch (error) {
    console.error('Paystack initialization error:', error);
    throw error;
  }
}

// For mobile money direct charge (alternative flow)
export interface MobileMoneyParams {
  phone: string;
  provider: 'mtn' | 'vod' | 'tgo'; // MTN, Vodafone, AirtelTigo
  amount: number;
  email: string;
  reference: string;
}

export function getProviderName(code: string): string {
  switch (code) {
    case 'mtn': return 'MTN Mobile Money';
    case 'vod': return 'Vodafone Cash';
    case 'tgo': return 'AirtelTigo Money';
    default: return 'Mobile Money';
  }
}

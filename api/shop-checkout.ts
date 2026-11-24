import { handleShopCheckout, type ApiRequest, type ApiResponse } from '../src/server/shop';
import { sendStoreMomoPayout, settleStoreMomoReversal, undoStoreMomoPayout, type StoreMomoPayoutRequest } from '../src/server/storeMomoPayout';
import { handlePriceScanPaymentVerification } from '../src/server/priceScanPayment';

function isPriceScanPayment(req: ApiRequest): boolean {
  const url = req.url || '';
  return url.includes('/api/price-scan-payment') || url.includes('action=price-scan-payment');
}

function isStoreMomoPayout(req: ApiRequest): boolean {
  const url = req.url || '';
  return url.includes('/api/store-momo-payout') || url.includes('action=store-momo-payout');
}

function rawBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') return JSON.parse(body || '{}') as Record<string, unknown>;
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

function payoutBody(body: unknown): StoreMomoPayoutRequest {
  const raw = rawBody(body);
  const amount = Number(raw.amountPesewas);
  return {
    storeId: typeof raw.storeId === 'string' ? raw.storeId : undefined,
    userId: typeof raw.userId === 'string' ? raw.userId : undefined,
    reference: typeof raw.reference === 'string' ? raw.reference : undefined,
    amountPesewas: Number.isFinite(amount) ? amount : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
  };
}

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (isPriceScanPayment(req)) {
    return handlePriceScanPaymentVerification(req, res).catch((error: unknown) => {
      console.error('[price-scan-payment] Unhandled handler failure:', error);
      res.status(500).json({ error: 'Pickup verification is temporarily unavailable. Please retry this paid order.' });
    });
  }
  if (!isStoreMomoPayout(req)) return handleShopCheckout(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return Promise.resolve();
  }
  let raw: Record<string, unknown>;
  try {
    raw = rawBody(req.body);
  } catch {
    res.status(400).json({ ok: false, error: 'The payout request could not be read.' });
    return Promise.resolve();
  }
  const action = String(raw.action || '');
  const body = payoutBody(raw);
  const run = action === 'undo'
    ? undoStoreMomoPayout(body)
    : action === 'settle'
      ? settleStoreMomoReversal(body)
      : sendStoreMomoPayout(body);
  return run.then((result) => {
    res.status(result.ok ? 200 : 400).json(result);
  });
}

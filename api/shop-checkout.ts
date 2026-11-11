import { handleShopCheckout, type ApiRequest, type ApiResponse } from '../src/server/shop';
import { sendStoreMomoPayout, type StoreMomoPayoutRequest } from '../src/server/storeMomoPayout';

function isStoreMomoPayout(req: ApiRequest): boolean {
  const url = req.url || '';
  return url.includes('/api/store-momo-payout') || url.includes('action=store-momo-payout');
}

function payoutBody(body: unknown): StoreMomoPayoutRequest {
  const raw = typeof body === 'string'
    ? JSON.parse(body || '{}') as Record<string, unknown>
    : (body && typeof body === 'object' ? body as Record<string, unknown> : {});
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
  if (!isStoreMomoPayout(req)) return handleShopCheckout(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return Promise.resolve();
  }
  let body: StoreMomoPayoutRequest;
  try {
    body = payoutBody(req.body);
  } catch {
    res.status(400).json({ ok: false, error: 'The payout request could not be read.' });
    return Promise.resolve();
  }
  return sendStoreMomoPayout(body).then((result) => {
    res.status(result.ok ? 200 : 400).json(result);
  });
}

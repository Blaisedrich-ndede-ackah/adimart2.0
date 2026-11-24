import { handlePriceScanPaymentVerification } from '../src/server/priceScanPayment';
import type { ApiRequest, ApiResponse } from '../src/server/shop';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    await handlePriceScanPaymentVerification(req, res);
  } catch (error: unknown) {
    console.error('[price-scan-payment] Unhandled handler failure:', error);
    res.status(500).json({ error: 'Pickup verification is temporarily unavailable. Please retry this paid order.' });
  }
}

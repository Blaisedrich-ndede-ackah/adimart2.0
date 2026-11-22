import { handlePriceScanPaymentVerification } from '../src/server/priceScanPayment';
import type { ApiRequest, ApiResponse } from '../src/server/shop';

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handlePriceScanPaymentVerification(req, res);
}

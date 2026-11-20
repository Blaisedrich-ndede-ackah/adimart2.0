import { handlePriceScanPaymentVerification, type ApiRequest, type ApiResponse } from '../src/server/priceScanPayment';

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handlePriceScanPaymentVerification(req, res);
}

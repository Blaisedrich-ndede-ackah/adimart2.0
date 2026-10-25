import { handleShopCheckout, type ApiRequest, type ApiResponse } from '../src/server/shop';

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handleShopCheckout(req, res);
}

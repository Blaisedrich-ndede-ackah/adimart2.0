import { handleShopAuth, type ApiRequest, type ApiResponse } from '../src/server/shop';

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handleShopAuth(req, res);
}

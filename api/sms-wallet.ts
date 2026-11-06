import type { ApiRequest, ApiResponse } from '../src/server/shop';
import { handleSmsWallet } from '../src/server/smsWallet';

export default function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  return handleSmsWallet(req, res);
}

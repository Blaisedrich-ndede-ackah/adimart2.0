import { handlePaystackReturn, type ApiRequest, type ApiResponse } from '../src/server/shop';

export default function handler(req: ApiRequest, res: ApiResponse): void {
  handlePaystackReturn(req, res);
}

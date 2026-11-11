import type { ApiRequest, ApiResponse } from '../src/server/shop';
import { sendStoreMomoPayout } from '../src/server/storeMomoPayout';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') as Record<string, unknown> : (req.body || {});
  const result = await sendStoreMomoPayout(body);
  res.status(result.ok ? 200 : 400).json(result);
}

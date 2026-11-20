import { handlePaystackWebhook, type ApiRequest, type ApiResponse } from '../src/server/shop';

export const config = { api: { bodyParser: false } };

async function rawBody(req: ApiRequest & AsyncIterable<Buffer | string> & { on?: unknown }): Promise<string> {
  if (typeof req.rawBody === 'string' && req.rawBody.length > 0) return req.rawBody;
  if (typeof req.on !== 'function') return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: ApiRequest & AsyncIterable<Buffer | string>, res: ApiResponse): Promise<void> {
  req.rawBody = await rawBody(req);
  return handlePaystackWebhook(req, res);
}

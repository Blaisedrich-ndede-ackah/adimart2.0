import { handleAdminActiveDevices } from '../src/server/adminActiveDevices';
import { handleAdminActivityLog } from '../src/server/adminActivityLog';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (status: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

export default function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  const queryAction = request.query?.action;
  const action = Array.isArray(queryAction) ? queryAction[0] : queryAction;
  const path = new URL(request.url || '/', 'http://localhost').pathname;

  if (action === 'active-devices' || path.endsWith('/admin-active-devices')) {
    return handleAdminActiveDevices(request, response);
  }
  if (action === 'activity-log' || path.endsWith('/admin-activity-log')) {
    return handleAdminActivityLog(request, response);
  }

  response.status(404).json({ error: 'Unknown admin monitoring action.' });
  return Promise.resolve();
}

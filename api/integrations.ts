import { handleIntegrations } from '../src/server/integrations';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (value: unknown) => void;
  setHeader: (name: string, value: string) => void;
  send?: (value: string) => void;
}

export default function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  return handleIntegrations(request, response);
}

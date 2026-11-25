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
  headersSent?: boolean;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  try {
    // Load server dependencies inside the handler so module-init failures are
    // caught and written to the Vercel function log instead of crashing cold start.
    const { handleIntegrations } = await import('../src/server/integrations');
    await handleIntegrations(request, response);
  } catch (error) {
    console.error('[api/integrations] Unhandled request failure:', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'Notification service failed before it could complete the request.' });
  }
}

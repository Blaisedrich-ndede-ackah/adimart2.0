const ADMIN_SESSION_KEY = 'adimat_admin_session';

interface AdminFunctionResponse {
  session?: string;
  error?: string;
  message?: string;
}

async function invokeAdminFunction(
  body: Record<string, unknown>
): Promise<AdminFunctionResponse> {
  let response: Response;
  try {
    response = await fetch('/api/manage-promotional-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the Vercel admin API. Confirm this app is deployed on Vercel with the /api/manage-promotional-campaigns route and check the internet connection.');
  }
  let data: AdminFunctionResponse | null = null;
  try {
    data = await response.json() as AdminFunctionResponse;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const routeHint = response.status === 404
      ? ' The /api/manage-promotional-campaigns route is missing; redeploy the latest version on Vercel.'
      : '';
    throw new Error(data?.error || data?.message || `Admin API request failed (${response.status}).${routeHint}`);
  }
  if (!data) throw new Error('The Vercel admin API returned an invalid response.');
  return data;
}

export async function verifyAdminPin(pin: string): Promise<string> {
  const response = await invokeAdminFunction({ action: 'login', pin: pin.trim() });
  if (!response.session) throw new Error('Administrator sign-in returned no session.');
  return response.session;
}

export function adminFunctionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'The administrator service could not be reached.';
  if (/failed to fetch|networkerror/i.test(error.message)) {
    return 'Could not reach the Vercel admin API. Confirm the app is deployed on Vercel with the /api/manage-promotional-campaigns route and check the internet connection.';
  }
  return error.message;
}

export function startAdminSession(session: string): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, session);
}

export function getAdminSessionToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export async function clearAdminSession(): Promise<void> {
  const session = getAdminSessionToken();
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  if (session) {
    await invokeAdminFunction({ action: 'logout', session });
  }
}

export async function restoreAdminSession(): Promise<boolean> {
  if (!isAdminSessionActive()) return false;
  try {
    await invokeAdminFunction({ action: 'verify-session', session: getAdminSessionToken() });
    return true;
  } catch {
    await clearAdminSession();
    return false;
  }
}

export function isAdminSessionActive(): boolean {
  return Boolean(getAdminSessionToken());
}

import { supabase } from './supabase';

const ADMIN_SESSION_KEY = 'adimat_admin_session';
const ADMIN_FUNCTION = 'manage-promotional-campaigns';

interface AdminFunctionResponse {
  session?: string;
  error?: string;
  message?: string;
}

async function invokeAdminFunction(
  body: Record<string, unknown>
): Promise<AdminFunctionResponse> {
  const { data, error } = await supabase.functions.invoke<AdminFunctionResponse>(
    ADMIN_FUNCTION,
    { body }
  );
  if (error) {
    if (error.context instanceof Response) {
      let responseBody: AdminFunctionResponse | null = null;
      try {
        responseBody = await error.context.clone().json() as AdminFunctionResponse;
      } catch {
        responseBody = null;
      }
      const responseMessage = responseBody?.error || responseBody?.message;
      if (responseMessage) throw new Error(responseMessage);
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('The administrator service returned no response.');
  if (data.error) throw new Error(data.error);
  return data;
}

export async function verifyAdminPin(pin: string): Promise<string> {
  const response = await invokeAdminFunction({ action: 'login', pin: pin.trim() });
  if (!response.session) throw new Error('Administrator sign-in returned no session.');
  return response.session;
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
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
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

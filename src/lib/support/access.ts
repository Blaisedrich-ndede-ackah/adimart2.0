import { getAdminSessionToken } from '@/lib/adminAuth';

const TOKEN_KEY = 'adimat_support_token';

export function getSupportToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function requestToken(body: Record<string, unknown>): Promise<void> {
  const response = await fetch('/api/customer-care', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { token?: string };
  if (response.ok && data.token) sessionStorage.setItem(TOKEN_KEY, data.token);
}

export async function issueOwnerSupportToken(storeId: string, userId: string, pin: string): Promise<void> {
  try {
    await requestToken({ action: 'issue-owner-token', storeId, userId, pin });
  } catch {
    // The shop can keep working offline without a cloud token.
  }
}

export async function issueAdminSupportToken(): Promise<void> {
  const session = getAdminSessionToken();
  if (!session) return;
  try {
    await requestToken({ action: 'issue-admin-token', session });
  } catch {
    // Admin inbox still shows tickets stored on this browser.
  }
}

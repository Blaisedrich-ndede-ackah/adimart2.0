import { getAdminSessionToken } from './adminAuth';

const PRESENCE_SESSION_PREFIX = 'adimat_presence_session:';

export type BrowserFamily = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Opera' | 'Samsung Internet' | 'Other';
export type OperatingSystem = 'Android' | 'iOS' | 'Windows' | 'macOS' | 'ChromeOS' | 'Linux' | 'Other';
export type DeviceType = 'Phone' | 'Tablet' | 'Desktop';

export interface ActiveDeviceSession {
  session_id: string;
  store_id: string;
  store_name: string;
  user_id: string;
  user_name: string;
  role: string;
  browser: BrowserFamily;
  operating_system: OperatingSystem;
  device_type: DeviceType;
  started_at: string;
  last_seen_at: string;
}

interface DeviceInfo {
  browser: BrowserFamily;
  operatingSystem: OperatingSystem;
  deviceType: DeviceType;
}

interface ApiResponse<T> {
  error?: string;
  devices?: T;
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function getPresenceSessionId(storeId: string, userId: string): string {
  const key = `${PRESENCE_SESSION_PREFIX}${storeId}:${userId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const sessionId = createUuid();
    sessionStorage.setItem(key, sessionId);
    return sessionId;
  } catch {
    return createUuid();
  }
}

function getDeviceInfo(): DeviceInfo {
  const userAgent = navigator.userAgent;
  const isAppleTablet = /iPad/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let browser: BrowserFamily = 'Other';
  if (/SamsungBrowser\//i.test(userAgent)) browser = 'Samsung Internet';
  else if (/Edg(?:A|iOS)?\//i.test(userAgent)) browser = 'Edge';
  else if (/OPR\/|OPiOS\//i.test(userAgent)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//i.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//i.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';

  let operatingSystem: OperatingSystem = 'Other';
  if (/Android/i.test(userAgent)) operatingSystem = 'Android';
  else if (/iPhone|iPad|iPod/i.test(userAgent) || isAppleTablet) operatingSystem = 'iOS';
  else if (/Windows/i.test(userAgent)) operatingSystem = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(userAgent)) operatingSystem = 'macOS';
  else if (/CrOS/i.test(userAgent)) operatingSystem = 'ChromeOS';
  else if (/Linux/i.test(userAgent)) operatingSystem = 'Linux';

  const isTablet = isAppleTablet || /Tablet/i.test(userAgent) ||
    (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent));
  const isPhone = /Mobile|iPhone|iPod|Android/i.test(userAgent) && !isTablet;

  return {
    browser,
    operatingSystem,
    deviceType: isTablet ? 'Tablet' : isPhone ? 'Phone' : 'Desktop',
  };
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let data: ApiResponse<T> | null = null;
  try {
    data = await response.json() as ApiResponse<T>;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || `Device service request failed (${response.status}).`);
  }
  if (!data) throw new Error('The device service returned an invalid response.');
  return data;
}

export async function sendDeviceHeartbeat(storeId: string, userId: string): Promise<void> {
  const info = getDeviceInfo();
  await postJson<never>('/api/user-device-presence', {
    storeId,
    userId,
    sessionId: getPresenceSessionId(storeId, userId),
    ...info,
  });
}

export async function loadActiveDeviceSessions(): Promise<ActiveDeviceSession[]> {
  const session = getAdminSessionToken();
  if (!session) throw new Error('Administrator session expired. Sign in again.');
  const response = await postJson<ActiveDeviceSession[]>('/api/admin-active-devices', { session });
  return response.devices || [];
}

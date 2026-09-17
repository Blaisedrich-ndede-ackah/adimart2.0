/**
 * Store-user PIN reset via SMS OTP (mNotify).
 */

import {
  db,
  getCurrentStoreId,
  updateUserPin,
  type LocalUser,
} from '@/lib/dexie';
import { sendSmsViaMnotify } from '@/lib/mnotify';
import { isValidGhanaPhone, normalizeGhanaPhone } from '@/lib/platformSettings';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { cashbookAccessFromCloud } from '@/lib/staffAccess';

const OTP_KEY = 'adimat_pin_reset_otp';
const OTP_TTL_MS = 5 * 60 * 1000;

interface PendingPinReset {
  userId: string;
  storeId: string;
  phone: string;
  code: string;
  expiresAt: number;
}

function readPending(): PendingPinReset | null {
  try {
    const raw = sessionStorage.getItem(OTP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPinReset;
    if (!parsed?.code || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(OTP_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePending(value: PendingPinReset): void {
  sessionStorage.setItem(OTP_KEY, JSON.stringify(value));
}

export function clearPinResetOtp(): void {
  sessionStorage.removeItem(OTP_KEY);
}

function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function findUserByPhoneForCurrentStore(phoneRaw: string): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  const normalized = normalizeGhanaPhone(phoneRaw);
  if (!normalized) return null;

  const localUsers = await db.users.where('store_id').equals(storeId).toArray();
  const localMatch = localUsers.find(
    (u) => u.is_active === 1 && normalizeGhanaPhone(u.phone || '') === normalized
  );
  if (localMatch) return localMatch;

  if (!isSupabaseConfigured()) return null;

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true);

  for (const row of data || []) {
    if (normalizeGhanaPhone(String(row.phone || '')) !== normalized) continue;
    const mapped: LocalUser = {
      id: String(row.id),
      store_id: String(row.store_id),
      name: String(row.name || ''),
      role: row.role === 'cashier' ? 'cashier' : 'owner',
      pin_hash: String(row.pin_hash || ''),
      is_active: 1,
      phone: String(row.phone || ''),
      assigned_location_id: (row.assigned_location_id as string) || null,
      can_wholesale: row.can_wholesale ? 1 : 0,
      can_sell_from_warehouse: row.can_sell_from_warehouse ? 1 : 0,
      can_manage_ecommerce: row.can_manage_ecommerce || row.role === 'owner' ? 1 : 0,
      can_access_cashbook: cashbookAccessFromCloud(row.role, row.can_access_cashbook),
      created_at: String(row.created_at || new Date().toISOString()),
      synced: 1,
    };
    await db.users.put(mapped);
    return mapped;
  }
  return null;
}

export async function requestPinResetOtp(
  phoneRaw: string
): Promise<{ success: boolean; message: string }> {
  if (!isValidGhanaPhone(phoneRaw)) {
    return { success: false, message: 'Enter a valid Ghana phone number.' };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected.' };
  }

  const user = await findUserByPhoneForCurrentStore(phoneRaw);
  if (!user) {
    return {
      success: false,
      message: 'No active user with that phone was found for this store.',
    };
  }

  const code = generateOtp();
  const sms = await sendSmsViaMnotify(
    phoneRaw,
    `Adimat PIN reset code: ${code}. Valid for 5 minutes. If you did not request this, ignore.`
  );

  if (!sms.success) {
    return {
      success: false,
      message: sms.error || 'Could not send SMS. Ask your admin to configure mNotify.',
    };
  }

  writePending({
    userId: user.id,
    storeId,
    phone: normalizeGhanaPhone(phoneRaw),
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  return { success: true, message: 'A 4-digit code was sent by SMS.' };
}

export async function confirmPinResetWithOtp(
  code: string,
  newPin: string
): Promise<{ success: boolean; message: string }> {
  const pending = readPending();
  if (!pending) {
    return { success: false, message: 'Code expired. Request a new one.' };
  }
  if (code.trim() !== pending.code) {
    return { success: false, message: 'Incorrect code.' };
  }
  if (!/^\d{4}$/.test(newPin)) {
    return { success: false, message: 'New PIN must be 4 digits.' };
  }

  const storeId = await getCurrentStoreId();
  if (storeId !== pending.storeId) {
    clearPinResetOtp();
    return { success: false, message: 'Store changed. Start PIN reset again.' };
  }

  await updateUserPin(pending.userId, newPin);
  clearPinResetOtp();
  return { success: true, message: 'PIN updated. Sign in with your new PIN.' };
}

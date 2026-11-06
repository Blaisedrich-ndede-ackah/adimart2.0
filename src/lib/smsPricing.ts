/** Pricing for a store's own SMS. One unit is GH₵0.04 per 160 characters per recipient. */

export const SMS_UNIT_PESEWAS = 4;
export const SMS_SEGMENT_LENGTH = 160;
export const SMS_TOPUP_PRESETS_GHS = [5, 10, 20, 50] as const;

function ghanaSmsPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export function smsSegmentCount(message: string): number {
  const length = message.trim().length;
  if (length <= 0) return 0;
  return Math.ceil(length / SMS_SEGMENT_LENGTH);
}

export function smsCostPesewas(message: string, recipientCount: number): number {
  const people = Math.max(0, Math.floor(recipientCount));
  return smsSegmentCount(message) * people * SMS_UNIT_PESEWAS;
}

export function textsRemaining(balancePesewas: number): number {
  if (!Number.isFinite(balancePesewas) || balancePesewas <= 0) return 0;
  return Math.floor(balancePesewas / SMS_UNIT_PESEWAS);
}

export function canAffordSms(balancePesewas: number, message: string, recipientCount: number): boolean {
  const cost = smsCostPesewas(message, recipientCount);
  return cost > 0 && cost <= Math.max(0, balancePesewas);
}

/** A receipt text goes out only for an active customer of this store who already has a phone. */
export function customerPhoneOnFile(
  customer: { store_id?: string; is_active?: number; phone?: string | null } | null | undefined,
  storeId: string,
): string {
  if (!customer || customer.store_id !== storeId || customer.is_active !== 1) return '';
  const phone = ghanaSmsPhone(String(customer.phone || ''));
  return /^233[2-9]\d{8}$/.test(phone) ? phone : '';
}

export function receiptSmsMessage(input: {
  storeName: string;
  receiptNumber: string;
  totalLabel: string;
  balanceLabel?: string;
}): string {
  const store = input.storeName.trim().slice(0, 24) || 'Your store';
  const receipt = input.receiptNumber.trim().slice(0, 24);
  const balance = input.balanceLabel ? ` Balance ${input.balanceLabel}.` : '';
  return `${store}: Receipt ${receipt}. Total ${input.totalLabel}.${balance} Thank you.`.slice(0, 160);
}

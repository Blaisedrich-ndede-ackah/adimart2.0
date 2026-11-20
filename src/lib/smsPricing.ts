/** One store SMS unit is GH₵0.04, one 160-character segment, one recipient. */

export const SMS_UNIT_PESEWAS = 4;
export const SMS_SEGMENT_LENGTH = 160;
export const SMS_TOPUP_PRESETS_GHS = [5, 10, 20, 50] as const;

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

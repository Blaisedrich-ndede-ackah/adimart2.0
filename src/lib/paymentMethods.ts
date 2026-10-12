export type ManualPaymentMethod =
  | 'momo_mtn'
  | 'momo_telecel'
  | 'momo_airteltigo'
  | 'bank_transfer'
  | 'card_terminal';

export type PaymentMethod = 'cash' | 'split' | 'paystack' | ManualPaymentMethod;

export const MANUAL_PAYMENT_METHODS: Array<{ value: ManualPaymentMethod; label: string }> = [
  { value: 'momo_mtn', label: 'MTN MoMo' },
  { value: 'momo_telecel', label: 'Telecel Cash' },
  { value: 'momo_airteltigo', label: 'AirtelTigo Money' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card_terminal', label: 'Card terminal' },
];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  split: 'Split payment',
  paystack: 'Paystack',
  momo_mtn: 'MTN MoMo',
  momo_telecel: 'Telecel Cash',
  momo_airteltigo: 'AirtelTigo Money',
  bank_transfer: 'Bank transfer',
  card_terminal: 'Card terminal',
};

export function getPaymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] || method;
}

export function isManualPaymentMethod(method: PaymentMethod): method is ManualPaymentMethod {
  return MANUAL_PAYMENT_METHODS.some((option) => option.value === method);
}

/**
 * Pure configuration + message helpers for automated debt reminders.
 *
 * Kept free of database imports so both `dexie.ts` and `debtReminders.ts`
 * can use it without a circular dependency.
 */

/** Days between automated reminders for the same customer. */
export const DEFAULT_DEBT_REMINDER_INTERVAL_DAYS = 7;

/** Interval choices offered in Settings. */
export const DEBT_REMINDER_INTERVAL_OPTIONS = [1, 3, 7, 14, 30] as const;

/** GSM-7 safe maximum for a single mNotify quick SMS. */
export const DEBT_REMINDER_MAX_CHARS = 460;

/**
 * Default reminder text. Tokens: {name}, {store}, {balance}.
 */
export const DEFAULT_DEBT_REMINDER_TEMPLATE =
  'Hi {name}, this is {store}. Your outstanding balance is {balance}. Please pay at the store. Thank you!';

export interface DebtReminderSettings {
  enabled: boolean;
  intervalDays: number;
  minBalance: number;
  messageTemplate: string;
}

/** Clamp a stored interval to a sane, whole number of days (1–90). */
export function normalizeDebtReminderIntervalDays(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEBT_REMINDER_INTERVAL_DAYS;
  return Math.min(90, Math.max(1, parsed));
}

/** Clamp a stored minimum balance to a non-negative amount. */
export function normalizeDebtReminderMinBalance(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

export function normalizeDebtReminderTemplate(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return DEFAULT_DEBT_REMINDER_TEMPLATE;
  return text.slice(0, DEBT_REMINDER_MAX_CHARS);
}

/**
 * Fill the template tokens. Unknown tokens are left untouched so a shop
 * owner can write a literal message without the app rewriting it.
 */
export function renderDebtReminderMessage(
  template: string,
  tokens: { customerName: string; storeName: string; balance: string }
): string {
  const resolved = normalizeDebtReminderTemplate(template)
    .replace(/\{name\}/g, tokens.customerName.trim() || 'Customer')
    .replace(/\{store\}/g, tokens.storeName.trim() || 'our store')
    .replace(/\{balance\}/g, tokens.balance);
  return resolved.slice(0, DEBT_REMINDER_MAX_CHARS);
}

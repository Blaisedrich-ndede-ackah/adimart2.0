export type CreditLimitAction = 'warn' | 'block';

export function normalizeCreditLimitAction(value: unknown): CreditLimitAction {
  return value === 'block' ? 'block' : 'warn';
}

export interface CreditLimitDecision {
  overLimit: boolean;
  blocked: boolean;
  currentDebt: number;
  projectedDebt: number;
  limit: number | null;
  message: string;
}

export function evaluateCreditLimit(input: {
  currentDebt: number;
  saleAmount: number;
  creditLimit: number | null | undefined;
  action: CreditLimitAction;
}): CreditLimitDecision {
  const currentDebt = Math.max(0, Number(input.currentDebt) || 0);
  const saleAmount = Math.max(0, Number(input.saleAmount) || 0);
  const projectedDebt = Math.round((currentDebt + saleAmount) * 100) / 100;
  const rawLimit = input.creditLimit;
  const limit = rawLimit == null || rawLimit === ('' as unknown) ? null : Number(rawLimit);
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return {
      overLimit: false,
      blocked: false,
      currentDebt,
      projectedDebt,
      limit: null,
      message: '',
    };
  }
  const overLimit = projectedDebt > limit + 0.009;
  const blocked = overLimit && input.action === 'block';
  const message = overLimit
    ? `This credit sale would take the balance to ${projectedDebt.toFixed(2)}, above the limit of ${limit.toFixed(2)}.`
    : '';
  return { overLimit, blocked, currentDebt, projectedDebt, limit, message };
}

export function creditDueDate(termsDays: number | null | undefined, from = new Date()): string | null {
  const days = Number(termsDays);
  if (!Number.isFinite(days) || days < 0) return null;
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + Math.floor(days));
  return date.toISOString().slice(0, 10);
}

export function isOverdueCreditSale(
  sale: {
    payment_method?: string | null;
    status?: string | null;
    void_status?: string | null;
    credit_balance?: number | null;
    credit_due_date?: string | null;
  },
  today = new Date().toISOString().slice(0, 10)
): boolean {
  if (sale.payment_method !== 'credit') return false;
  if (sale.status !== 'completed' || sale.void_status === 'voided') return false;
  if ((Number(sale.credit_balance) || 0) <= 0) return false;
  const due = (sale.credit_due_date || '').slice(0, 10);
  if (!due) return false;
  return due < today;
}

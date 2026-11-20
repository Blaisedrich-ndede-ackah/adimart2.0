export interface PayableLine {
  quantity: number;
  unit_cost: number;
  received_quantity: number;
}

export function receivedPayableValue(lines: PayableLine[]): number {
  return Math.round(
    lines.reduce((sum, line) => {
      const received = Math.max(0, Number(line.received_quantity) || 0);
      const cost = Math.max(0, Number(line.unit_cost) || 0);
      return sum + received * cost;
    }, 0) * 100
  ) / 100;
}

export function payableBalance(receivedValue: number, amountPaid: number): number {
  return Math.max(0, Math.round((receivedValue - (Number(amountPaid) || 0)) * 100) / 100);
}

export function isOverduePayable(input: {
  balance: number;
  dueDate?: string | null;
  status?: string | null;
}, today = new Date().toISOString().slice(0, 10)): boolean {
  if (input.status === 'cancelled') return false;
  if (input.balance <= 0.009) return false;
  const due = (input.dueDate || '').slice(0, 10);
  if (!due) return false;
  return due < today;
}

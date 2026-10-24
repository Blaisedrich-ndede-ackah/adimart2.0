export type SalesPeriod = 'all' | 'today' | 'week' | 'custom';

export interface SalesRangeResult<T> {
  rows: T[];
  error: string;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** datetime-local values have minute precision. The end minute is included. */
export function parseRangeBound(value: string, end: boolean): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  if (end && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    date.setSeconds(59, 999);
  }
  return date.getTime();
}

export function filterSalesByPeriod<T extends { created_at: string }>(
  rows: T[],
  period: SalesPeriod,
  from: string,
  to: string,
  now = new Date()
): SalesRangeResult<T> {
  if (period === 'all') return { rows, error: '' };
  if (period === 'today' || period === 'week') {
    const floor = period === 'today'
      ? startOfDay(now)
      : startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    return {
      rows: rows.filter((row) => new Date(row.created_at).getTime() >= floor),
      error: '',
    };
  }

  if (!from || !to) {
    return { rows, error: '' };
  }
  const start = parseRangeBound(from, false);
  const end = parseRangeBound(to, true);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return { rows: [], error: 'The start must be before the end.' };
  }
  return {
    rows: rows.filter((row) => {
      const at = new Date(row.created_at).getTime();
      return at >= start && at <= end;
    }),
    error: '',
  };
}

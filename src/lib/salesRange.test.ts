import { describe, expect, it } from 'vitest';
import { filterSalesByPeriod } from './salesRange';
import { canRecordCustomerPayments, cashierCanSeeStockQuantity } from './staffAccess';

const rows = [
  { created_at: '2026-10-20T09:00:00.000Z', receipt: 'old' },
  { created_at: '2026-10-24T14:30:00', receipt: 'mid' },
  { created_at: '2026-10-24T18:00:30', receipt: 'late' },
];

describe('filterSalesByPeriod', () => {
  it('keeps every sale for all time', () => {
    expect(filterSalesByPeriod(rows, 'all', '', '').rows).toHaveLength(3);
  });

  it('keeps sales inside a custom from–to range, including the end minute', () => {
    const result = filterSalesByPeriod(rows, 'custom', '2026-10-24T14:00', '2026-10-24T18:00');
    expect(result.error).toBe('');
    expect(result.rows.map((row) => row.receipt)).toEqual(['mid', 'late']);
  });

  it('rejects a range that starts after it ends', () => {
    const result = filterSalesByPeriod(rows, 'custom', '2026-10-24T19:00', '2026-10-24T18:00');
    expect(result.rows).toEqual([]);
    expect(result.error).toBe('The start must be before the end.');
  });

  it('leaves the list unchanged until both custom times are set', () => {
    expect(filterSalesByPeriod(rows, 'custom', '2026-10-24T14:00', '').rows).toHaveLength(3);
  });
});

describe('canRecordCustomerPayments', () => {
  it('lets owners record payments and waits for the owner to allow cashiers', () => {
    expect(canRecordCustomerPayments({ role: 'owner' }, { cashier_can_record_payments: 0 })).toBe(true);
    expect(canRecordCustomerPayments({ role: 'cashier' }, {})).toBe(false);
    expect(canRecordCustomerPayments({ role: 'cashier' }, { cashier_can_record_payments: 0 })).toBe(false);
    expect(canRecordCustomerPayments({ role: 'cashier' }, { cashier_can_record_payments: 1 })).toBe(true);
    expect(canRecordCustomerPayments({ role: 'manager' }, { cashier_can_record_payments: 1 })).toBe(false);
    expect(canRecordCustomerPayments(null, { cashier_can_record_payments: 1 })).toBe(false);
  });
});

describe('cashierCanSeeStockQuantity', () => {
  it('shows quantities to owners and hides them from cashiers until the owner allows it', () => {
    expect(cashierCanSeeStockQuantity({ role: 'owner' }, { cashier_can_see_stock: 0 })).toBe(true);
    expect(cashierCanSeeStockQuantity({ role: 'cashier' }, {})).toBe(false);
    expect(cashierCanSeeStockQuantity({ role: 'cashier' }, { cashier_can_see_stock: 0 })).toBe(false);
    expect(cashierCanSeeStockQuantity({ role: 'cashier' }, { cashier_can_see_stock: 1 })).toBe(true);
  });
});

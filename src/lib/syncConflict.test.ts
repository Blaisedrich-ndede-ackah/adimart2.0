import { describe, expect, it } from 'vitest';
import {
  applyStockDeltas,
  lastWriteWins,
  mergeBalanceDeltas,
  nextRetryDelayMs,
  reconcileDevices,
  reconcileStock,
  signedStockDelta,
} from './syncConflict';

describe('sync conflict handling', () => {
  it('keeps the later simple-field write', () => {
    const winner = lastWriteWins(
      { updated_at: '2026-10-24T01:00:00.000Z', version: 1, name: 'Rice' },
      { updated_at: '2026-10-24T02:00:00.000Z', version: 1, name: 'Rice 5kg' }
    );
    expect(winner.name).toBe('Rice 5kg');
  });

  it('uses version when timestamps match', () => {
    const winner = lastWriteWins(
      { updated_at: '2026-10-24T01:00:00.000Z', version: 4, name: 'A' },
      { updated_at: '2026-10-24T01:00:00.000Z', version: 2, name: 'B' }
    );
    expect(winner.name).toBe('A');
  });

  it('applies stock deltas once per idempotency key', () => {
    const once = applyStockDeltas(10, [
      { key: 'sale-a', delta: -3 },
      { key: 'sale-a', delta: -3 },
      { key: 'sale-b', delta: -4 },
    ]);
    expect(once.quantity).toBe(3);
    expect(once.appliedKeys).toEqual(['sale-a', 'sale-b']);
  });

  it('reconciles two offline devices to the same stock and fields', () => {
    const baseRow = {
      id: 'p1',
      updated_at: '2026-10-24T00:00:00.000Z',
      version: 1,
      fields: { name: 'Rice', price: 10 },
    };
    const deviceA = {
      rows: [{ ...baseRow, updated_at: '2026-10-24T03:00:00.000Z', version: 2, fields: { name: 'Rice 5kg', price: 10 } }],
      stockBase: 10,
      stockDeltas: [{ key: 'sale-a', delta: signedStockDelta({ movement_type: 'sale', quantity: 3 }) }],
      balanceBase: 100,
      balanceDelta: -20,
    };
    const deviceB = {
      rows: [{ ...baseRow, updated_at: '2026-10-24T02:00:00.000Z', version: 2, fields: { name: 'Rice', price: 12 } }],
      stockBase: 10,
      stockDeltas: [{ key: 'sale-b', delta: -4 }],
      balanceBase: 100,
      balanceDelta: -15,
    };
    const result = reconcileDevices(deviceA, deviceB);
    expect(result.a.stock).toBe(3);
    expect(result.b.stock).toBe(result.a.stock);
    expect(result.a.rows[0].fields.name).toBe('Rice 5kg');
    expect(result.a.rows[0].fields.price).toBe(10);
    expect(result.b.balance).toBe(result.a.balance);
    expect(result.a.balance).toBe(mergeBalanceDeltas(100 - 15, -20));
    expect(reconcileStock(10, deviceA.stockDeltas, deviceB.stockDeltas)).toBe(3);
  });

  it('backs off retries without growing forever', () => {
    expect(nextRetryDelayMs(1)).toBe(1000);
    expect(nextRetryDelayMs(2)).toBe(2000);
    expect(nextRetryDelayMs(3)).toBe(4000);
    expect(nextRetryDelayMs(20)).toBe(60_000);
  });
});

import { describe, expect, it } from 'vitest';
import { summarizeTickets } from './reports';
import { slaClock, slaDueDates } from './sla';
import type { LocalSupportTicket } from './types';

function ticket(patch: Partial<LocalSupportTicket>): LocalSupportTicket {
  return {
    id: '1',
    store_id: 'store',
    reference: 'CARE-1',
    source: 'owner',
    customer_name: 'Shop',
    customer_phone: '0240000000',
    customer_email: '',
    category: 'billing',
    priority: 'normal',
    status: 'open',
    assignee_name: '',
    subject: 'Help',
    opened_by_name: 'Owner',
    sla_first_response_due: '2026-10-24T08:00:00.000Z',
    sla_resolution_due: '2026-10-26T00:00:00.000Z',
    first_response_at: null,
    resolved_at: null,
    version: 1,
    created_at: '2026-10-24T00:00:00.000Z',
    updated_at: '2026-10-24T00:00:00.000Z',
    synced: 1,
    ...patch,
  };
}

describe('customer care reports', () => {
  it('counts volume, resolution rate, response time, and categories', () => {
    const report = summarizeTickets([
      ticket({ id: '1', category: 'billing', status: 'resolved', first_response_at: '2026-10-24T01:00:00.000Z', resolved_at: '2026-10-24T05:00:00.000Z' }),
      ticket({ id: '2', category: 'billing', status: 'open' }),
      ticket({ id: '3', category: 'stock', status: 'closed', first_response_at: '2026-10-24T02:00:00.000Z', resolved_at: '2026-10-24T04:00:00.000Z' }),
    ]);
    expect(report.volume).toBe(3);
    expect(report.openCount).toBe(1);
    expect(report.resolutionRate).toBe(67);
    expect(report.avgFirstResponseMinutes).toBe(90);
    expect(report.topCategories[0]).toEqual({ category: 'billing', count: 2 });
  });

  it('marks an unanswered urgent ticket as breached after the due time', () => {
    const due = slaDueDates('urgent', '2026-10-24T00:00:00.000Z');
    expect(slaClock(due.sla_first_response_due, null, Date.parse('2026-10-24T02:00:00.000Z'))).toBe('breached');
    expect(slaClock(due.sla_first_response_due, '2026-10-24T00:30:00.000Z', Date.parse('2026-10-24T02:00:00.000Z'))).toBe('met');
  });
});

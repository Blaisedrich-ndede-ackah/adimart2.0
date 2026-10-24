import type { SupportPriority, SupportStatus } from './types';

const FIRST_RESPONSE_MINUTES: Record<SupportPriority, number> = {
  urgent: 60,
  high: 4 * 60,
  normal: 8 * 60,
  low: 24 * 60,
};

const RESOLUTION_MINUTES: Record<SupportPriority, number> = {
  urgent: 8 * 60,
  high: 24 * 60,
  normal: 48 * 60,
  low: 72 * 60,
};

export function addMinutes(iso: string, minutes: number): string {
  const start = Date.parse(iso);
  const base = Number.isFinite(start) ? start : Date.now();
  return new Date(base + minutes * 60_000).toISOString();
}

export function slaDueDates(priority: SupportPriority, createdAt: string): {
  sla_first_response_due: string;
  sla_resolution_due: string;
} {
  return {
    sla_first_response_due: addMinutes(createdAt, FIRST_RESPONSE_MINUTES[priority]),
    sla_resolution_due: addMinutes(createdAt, RESOLUTION_MINUTES[priority]),
  };
}

export type SlaClock = 'met' | 'ok' | 'due' | 'breached';

export function slaClock(dueAt: string | null, doneAt: string | null, now = Date.now()): SlaClock {
  if (doneAt) {
    const done = Date.parse(doneAt);
    const due = Date.parse(dueAt || '');
    if (Number.isFinite(done) && Number.isFinite(due) && done > due) return 'breached';
    return 'met';
  }
  const due = Date.parse(dueAt || '');
  if (!Number.isFinite(due)) return 'ok';
  if (now > due) return 'breached';
  if (due - now < 60 * 60_000) return 'due';
  return 'ok';
}

export function isClosedStatus(status: SupportStatus): boolean {
  return status === 'resolved' || status === 'closed';
}

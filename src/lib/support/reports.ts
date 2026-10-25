import type { LocalSupportTicket } from './types';

export interface SupportReport {
  volume: number;
  openCount: number;
  resolvedCount: number;
  resolutionRate: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  topCategories: Array<{ category: string; count: number }>;
}

function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 60_000);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeTickets(tickets: LocalSupportTicket[]): SupportReport {
  const resolved = tickets.filter((ticket) => ticket.status === 'resolved' || ticket.status === 'closed');
  const firstResponses = tickets
    .map((ticket) => minutesBetween(ticket.created_at, ticket.first_response_at))
    .filter((value): value is number => value !== null);
  const resolutions = tickets
    .map((ticket) => minutesBetween(ticket.created_at, ticket.resolved_at))
    .filter((value): value is number => value !== null);
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    counts.set(ticket.category, (counts.get(ticket.category) || 0) + 1);
  }
  const topCategories = Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return {
    volume: tickets.length,
    openCount: tickets.length - resolved.length,
    resolvedCount: resolved.length,
    resolutionRate: tickets.length === 0 ? 0 : Math.round((resolved.length / tickets.length) * 100),
    avgFirstResponseMinutes: average(firstResponses),
    avgResolutionMinutes: average(resolutions),
    topCategories,
  };
}

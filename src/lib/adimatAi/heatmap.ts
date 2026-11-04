import { parseDate } from './dates';
import { completedSales } from './snapshot';
import type { AiSnapshot, HeatmapResult } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function periodLabel(weekday: number, hour: number): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${WEEKDAYS[weekday] || 'Day'} ${hour12}:00 ${suffix}`;
}

export function analyzeHeatmap(snapshot: AiSnapshot): HeatmapResult {
  const cells = new Map<string, { weekday: number; hour: number; total: number; count: number }>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.set(`${weekday}-${hour}`, { weekday, hour, total: 0, count: 0 });
    }
  }
  for (const sale of completedSales(snapshot)) {
    const when = parseDate(sale.createdAt);
    const key = `${when.getDay()}-${when.getHours()}`;
    const cell = cells.get(key);
    if (!cell) continue;
    cell.total += sale.total;
    cell.count += 1;
  }
  const list = [...cells.values()];
  const saleCount = list.reduce((sum, cell) => sum + cell.count, 0);
  const enough = saleCount >= 8;
  const busiest = [...list].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, 3)
    .filter((cell) => cell.count > 0)
    .map((cell) => ({ weekday: cell.weekday, hour: cell.hour, total: Math.round(cell.total * 100) / 100 }));
  const opening = snapshot.settings.openingHour;
  const closing = snapshot.settings.closingHour;
  const slowest = list
    .filter((cell) => cell.hour >= opening && cell.hour < closing)
    .sort((a, b) => a.total - b.total || a.count - b.count)
    .slice(0, 3)
    .map((cell) => ({ weekday: cell.weekday, hour: cell.hour, total: Math.round(cell.total * 100) / 100 }));
  const busyText = busiest.map((cell) => periodLabel(cell.weekday, cell.hour)).join(', ') || '—';
  const slowText = slowest.map((cell) => periodLabel(cell.weekday, cell.hour)).join(', ') || '—';
  return {
    cells: list,
    busiest,
    slowest: enough ? slowest : [],
    enough,
    confidence: enough ? 'high' : 'low',
    whyKey: enough ? 'ai.why.heatmap' : 'ai.why.heatmapLow',
    whyVars: { busy: busyText, slow: slowText },
  };
}

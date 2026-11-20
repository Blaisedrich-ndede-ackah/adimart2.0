import { addDays, dayKey, roundTo, startOfLocalDay } from './dates';
import { mean as average } from './stats';

export interface DemandEstimate {
  daily: number;
  demand: number;
  observedDays: number;
  horizonDays: number;
}

/**
 * Average daily sales over the lookback, weighted by weekday.
 * Each future day in the horizon uses that weekday's own average.
 */
export function weightedDailyDemand(
  qtyByDay: Map<string, number>,
  now: Date,
  weeks: number,
  horizonDays: number
): DemandEstimate {
  const end = startOfLocalDay(now);
  const start = addDays(end, -weeks * 7);
  const byWeekday: number[][] = [[], [], [], [], [], [], []];
  let observedDays = 0;
  for (let cursor = new Date(start); cursor < end; cursor = addDays(cursor, 1)) {
    const qty = qtyByDay.get(dayKey(cursor)) || 0;
    byWeekday[cursor.getDay()].push(qty);
    if (qty > 0) observedDays += 1;
  }
  const weekdayAverage = byWeekday.map((days) => (days.length ? average(days) : 0));
  let demand = 0;
  for (let offset = 0; offset < horizonDays; offset += 1) {
    demand += weekdayAverage[addDays(end, offset).getDay()];
  }
  return {
    daily: horizonDays > 0 ? demand / horizonDays : 0,
    demand,
    observedDays,
    horizonDays,
  };
}

export function daysOfCover(onHand: number, daily: number): number | null {
  if (daily <= 0.0001) return null;
  return roundTo(onHand / daily, 1);
}

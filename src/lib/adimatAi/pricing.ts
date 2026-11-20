import { clamp, roundTo } from './dates';

/**
 * Suggest a markdown between 10% and 20%.
 * Near expiry and slow sales push toward 20%. Plenty of time and fast sales stay near 10%.
 */
export function markdownPercent(input: {
  daysToExpiry: number | null;
  windowDays: number;
  stock: number;
  weeklySales: number;
}): number {
  const weekly = Math.max(0, input.weeklySales);
  const coverWeeks = weekly > 0 ? Math.max(0, input.stock) / weekly : 12;
  const excess = clamp((coverWeeks - 2) / 8, 0, 1);
  let urgency: number;
  if (input.daysToExpiry == null) urgency = 0.75;
  else if (input.daysToExpiry <= 0) urgency = 1;
  else urgency = clamp(1 - input.daysToExpiry / Math.max(1, input.windowDays), 0, 1);
  const raw = 10 + 10 * (0.65 * urgency + 0.35 * excess);
  return clamp(Math.round(raw), 10, 20);
}

export function marginRatio(selling: number, cost: number): number {
  if (selling <= 0) return 0;
  return roundTo((selling - cost) / selling, 4);
}

/** Price that restores a previous margin after the cost changed. */
export function priceToRestoreMargin(latestCost: number, previousMargin: number): number {
  if (latestCost <= 0) return 0;
  const keep = clamp(previousMargin, 0, 0.9);
  const price = latestCost / (1 - keep);
  return roundTo(price, 2);
}

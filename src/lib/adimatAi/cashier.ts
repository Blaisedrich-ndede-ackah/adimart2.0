import { addDays, daysBetween, parseDate, roundTo, startOfLocalDay } from './dates';
import { median, zScore } from './stats';
import { completedSales, nowOf } from './snapshot';
import type { AiSale, AiSnapshot, CashierFlag } from './types';

const RECENT_DAYS = 14;
const MIN_BASELINE = 8;

function discountRate(sale: AiSale): number {
  const gross = sale.total + Math.max(0, sale.discount);
  if (gross <= 0) return 0;
  return Math.max(0, sale.discount) / gross;
}

function outsideHours(sale: AiSale, opening: number, closing: number): boolean {
  const hour = parseDate(sale.createdAt).getHours();
  return hour < opening || hour >= closing;
}

function unusual(recent: number, baseline: number): boolean {
  if (recent < 2) return false;
  if (baseline <= 0) return recent >= 3;
  return recent > baseline * 2;
}

export function analyzeCashiers(snapshot: AiSnapshot): CashierFlag[] {
  const now = startOfLocalDay(nowOf(snapshot));
  const recentStart = addDays(now, -RECENT_DAYS);
  const sales = completedSales(snapshot, null);
  const byCashier = new Map<string, AiSale[]>();
  for (const sale of sales) {
    if (!sale.cashierId) continue;
    const list = byCashier.get(sale.cashierId) || [];
    list.push(sale);
    byCashier.set(sale.cashierId, list);
  }
  const flags: CashierFlag[] = [];

  for (const [cashierId, cashierSales] of byCashier) {
    const name = cashierSales.find((sale) => sale.cashierName)?.cashierName || cashierId;
    const baseline = cashierSales.filter((sale) => parseDate(sale.createdAt) < recentStart);
    const recent = cashierSales.filter((sale) => parseDate(sale.createdAt) >= recentStart);
    if (baseline.length < MIN_BASELINE || recent.length < 4) continue;

    const baselineRates = baseline.map(discountRate);
    const recentRates = recent.map(discountRate);
    const baselineMedian = median(baselineRates);
    const recentMedian = median(recentRates);
    const z = zScore(recentMedian, baselineRates);
    const ratio = baselineMedian > 0 ? recentMedian / baselineMedian : recentMedian > 0 ? 99 : 1;
    if ((z != null && z > 2) || (baselineMedian > 0 && recentMedian > baselineMedian * 2)) {
      flags.push({
        id: `${cashierId}-discount`,
        cashierId,
        cashierName: name,
        kind: 'discount',
        confidence: z != null && z > 2 && ratio >= 2 ? 'high' : 'medium',
        whyKey: 'ai.why.cashierDiscount',
        whyVars: {
          name,
          recent: roundTo(recentMedian * 100, 1),
          baseline: roundTo(baselineMedian * 100, 1),
          ratio: roundTo(ratio, 1),
        },
      });
    }

    const baselineDays = Math.max(RECENT_DAYS, daysBetween(recentStart, parseDate(baseline[0] ? oldest(baseline) : snapshot.now)));
    const refunds = snapshot.returns.filter((row) => row.createdBy === cashierId);
    const recentRefunds = refunds.filter((row) => parseDate(row.createdAt) >= recentStart).length;
    const olderRefunds = refunds.filter((row) => parseDate(row.createdAt) < recentStart).length;
    const expectedRefunds = olderRefunds / baselineDays * RECENT_DAYS;
    if (unusual(recentRefunds, expectedRefunds)) {
      flags.push({
        id: `${cashierId}-refund`,
        cashierId,
        cashierName: name,
        kind: 'refund',
        confidence: 'medium',
        whyKey: 'ai.why.cashierRefund',
        whyVars: { name, recent: recentRefunds, baseline: roundTo(expectedRefunds, 1) },
      });
    }

    const adjustments = snapshot.movements.filter((row) => row.type === 'adjust' && row.userId === cashierId);
    const recentAdjust = adjustments.filter((row) => parseDate(row.createdAt) >= recentStart).length;
    const olderAdjust = adjustments.filter((row) => parseDate(row.createdAt) < recentStart).length;
    const expectedAdjust = olderAdjust / baselineDays * RECENT_DAYS;
    if (unusual(recentAdjust, expectedAdjust)) {
      flags.push({
        id: `${cashierId}-adjust`,
        cashierId,
        cashierName: name,
        kind: 'adjustment',
        confidence: 'medium',
        whyKey: 'ai.why.cashierAdjust',
        whyVars: { name, recent: recentAdjust, baseline: roundTo(expectedAdjust, 1) },
      });
    }

    const opening = snapshot.settings.openingHour;
    const closing = snapshot.settings.closingHour;
    const recentOutside = recent.filter((sale) => outsideHours(sale, opening, closing)).length;
    const baselineOutside = baseline.filter((sale) => outsideHours(sale, opening, closing)).length;
    const recentShare = recentOutside / recent.length;
    const baselineShare = baselineOutside / baseline.length;
    const hoursUnusual = recentOutside >= 2 && (baselineShare <= 0 ? recentShare >= 0.5 : recentShare > baselineShare * 2);
    if (hoursUnusual) {
      flags.push({
        id: `${cashierId}-hours`,
        cashierId,
        cashierName: name,
        kind: 'hours',
        confidence: 'medium',
        whyKey: 'ai.why.cashierHours',
        whyVars: {
          name,
          recent: recentOutside,
          open: opening,
          close: closing,
          baseline: roundTo(baselineShare * 100, 1),
        },
      });
    }
  }

  return flags;
}

function oldest(sales: AiSale[]): string {
  return sales.reduce((min, sale) => (sale.createdAt < min ? sale.createdAt : min), sales[0]?.createdAt || '');
}

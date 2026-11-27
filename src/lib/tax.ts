import { roundMoney } from '@/lib/money';

export type ProductTaxCategory = 'taxable' | 'exempt' | 'zero_rated' | 'reduced';

export interface TaxConfig {
  vatRate: number;
  nhilEnabled: boolean;
  nhilRate: number;
  getfundEnabled: boolean;
  getfundRate: number;
  covidLevyEnabled: boolean;
  covidLevyRate: number;
  inclusive: boolean;
}

export interface TaxLineInput {
  id: string;
  subtotal: number;
  taxCategory?: ProductTaxCategory;
  taxRateOverride?: number | null;
}

export interface TaxLineResult {
  id: string;
  taxAmount: number;
  taxRate: number;
}

export interface TaxComponent {
  id: 'vat' | 'nhil' | 'getfund' | 'covid_levy';
  label: string;
  rate: number;
  amount: number;
}

export interface TaxCalculation {
  total: number;
  breakdown: TaxComponent[];
  lines: TaxLineResult[];
}

const safeRate = (rate: number): number => Math.max(0, Math.min(100, Number(rate) || 0));

/** Calculate configurable sales tax after discounts, without hard-coding tax law. */
export function calculateSalesTax(
  lines: TaxLineInput[],
  discountedSubtotal: number,
  config: TaxConfig,
  customerExempt = false,
): TaxCalculation {
  const componentTotals = new Map<TaxComponent['id'], TaxComponent>([
    ['vat', { id: 'vat', label: 'VAT', rate: 0, amount: 0 }],
    ['nhil', { id: 'nhil', label: 'NHIL', rate: 0, amount: 0 }],
    ['getfund', { id: 'getfund', label: 'GETFund', rate: 0, amount: 0 }],
    ['covid_levy', { id: 'covid_levy', label: 'COVID levy', rate: 0, amount: 0 }],
  ]);
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.subtotal) || 0), 0);
  const discountRatio = subtotal > 0 ? Math.max(0, discountedSubtotal) / subtotal : 0;
  const lineResults: TaxLineResult[] = [];

  for (const line of lines) {
    const category = line.taxCategory || 'taxable';
    const base = Math.max(0, Number(line.subtotal) || 0) * discountRatio;
    const noTax = customerExempt || category === 'exempt' || category === 'zero_rated';
    const vatRate = noTax ? 0 : safeRate(category === 'reduced'
      ? Number(line.taxRateOverride) || 0
      : line.taxRateOverride == null ? config.vatRate : Number(line.taxRateOverride));
    const componentRates = [
      vatRate,
      noTax || !config.nhilEnabled ? 0 : safeRate(config.nhilRate),
      noTax || !config.getfundEnabled ? 0 : safeRate(config.getfundRate),
      noTax || !config.covidLevyEnabled ? 0 : safeRate(config.covidLevyRate),
    ];
    const combinedRate = componentRates.reduce((sum, rate) => sum + rate, 0);
    let lineTax = 0;
    const ids: TaxComponent['id'][] = ['vat', 'nhil', 'getfund', 'covid_levy'];
    ids.forEach((id, index) => {
      const rate = componentRates[index];
      const amount = roundMoney(base * rate / (config.inclusive ? 100 + combinedRate : 100));
      lineTax += amount;
      const component = componentTotals.get(id)!;
      component.rate = Math.max(component.rate, rate);
      component.amount = roundMoney(component.amount + amount);
    });
    lineResults.push({ id: line.id, taxAmount: roundMoney(lineTax), taxRate: combinedRate });
  }

  const breakdown = [...componentTotals.values()].filter((component) => component.rate > 0);
  return {
    total: roundMoney(breakdown.reduce((sum, component) => sum + component.amount, 0)),
    breakdown,
    lines: lineResults,
  };
}

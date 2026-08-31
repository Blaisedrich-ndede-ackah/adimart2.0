import { useCallback } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { type AppLanguage, useI18nStore } from '@/lib/i18n';

export const DEFAULT_CURRENCY = 'GHS';

export interface StoreCurrency {
  code: string;
  /** On-screen symbol or short label. */
  symbol: string;
  /** ISO code used in PDFs and thermal print (Helvetica-safe). */
  pdfCode: string;
  nameEn: string;
  nameFr: string;
}

export const STORE_CURRENCIES: StoreCurrency[] = [
  { code: 'GHS', symbol: 'GH₵', pdfCode: 'GHS', nameEn: 'Ghana Cedi', nameFr: 'Cédi ghanéen' },
  { code: 'XOF', symbol: 'F CFA', pdfCode: 'XOF', nameEn: 'West African CFA franc', nameFr: 'Franc CFA (BCEAO)' },
  { code: 'XAF', symbol: 'FCFA', pdfCode: 'XAF', nameEn: 'Central African CFA franc', nameFr: 'Franc CFA (BEAC)' },
  { code: 'NGN', symbol: '₦', pdfCode: 'NGN', nameEn: 'Nigerian Naira', nameFr: 'Naira nigérian' },
  { code: 'USD', symbol: '$', pdfCode: 'USD', nameEn: 'US Dollar', nameFr: 'Dollar américain' },
  { code: 'EUR', symbol: '€', pdfCode: 'EUR', nameEn: 'Euro', nameFr: 'Euro' },
  { code: 'GBP', symbol: '£', pdfCode: 'GBP', nameEn: 'British Pound', nameFr: 'Livre sterling' },
  { code: 'SLE', symbol: 'Le', pdfCode: 'SLE', nameEn: 'Sierra Leonean Leone', nameFr: 'Leone sierra-léonais' },
  { code: 'GMD', symbol: 'D', pdfCode: 'GMD', nameEn: 'Gambian Dalasi', nameFr: 'Dalasi gambien' },
  { code: 'LRD', symbol: 'L$', pdfCode: 'LRD', nameEn: 'Liberian Dollar', nameFr: 'Dollar libérien' },
];

export function normalizeCurrencyCode(code?: string | null): string {
  const upper = (code || DEFAULT_CURRENCY).trim().toUpperCase();
  return STORE_CURRENCIES.some((c) => c.code === upper) ? upper : DEFAULT_CURRENCY;
}

export function getStoreCurrency(code?: string | null): StoreCurrency {
  const normalized = normalizeCurrencyCode(code);
  return STORE_CURRENCIES.find((c) => c.code === normalized) || STORE_CURRENCIES[0];
}

function numberLocale(language: AppLanguage): string {
  return language === 'fr' ? 'fr-FR' : 'en-GH';
}

function formatAmount(amount: number, language: AppLanguage): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return Math.abs(n).toLocaleString(numberLocale(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** On-screen money for the active store. */
export function formatStoreMoney(
  amount: number,
  currencyCode?: string | null,
  language: AppLanguage = 'en'
): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const currency = getStoreCurrency(currencyCode);
  const formatted = formatAmount(n, language);
  const negative = n < 0;
  const withSymbol =
    language === 'fr'
      ? `${formatted} ${currency.symbol}`
      : `${currency.symbol}${formatted}`;
  return negative ? `-${withSymbol}` : withSymbol;
}

/** ISO-code money for PDFs and thermal printers (no special glyphs). */
export function formatOfficialMoney(amount: number, currencyCode?: string | null): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const currency = getStoreCurrency(currencyCode);
  const formatted = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const body = `${currency.pdfCode} ${formatted}`;
  return n < 0 ? `(${body})` : body;
}

export function currencyName(code: string | null | undefined, language: AppLanguage): string {
  const currency = getStoreCurrency(code);
  return language === 'fr' ? currency.nameFr : currency.nameEn;
}

export function useFormatMoney() {
  const language = useI18nStore((s) => s.language);
  const code = useAuthStore((s) => s.currentStore?.currency_code);
  return useCallback(
    (amount: number) => formatStoreMoney(amount, code, language),
    [code, language]
  );
}

export function formatStoreMoneyNow(amount: number): string {
  const language = useI18nStore.getState().language;
  const code = useAuthStore.getState().currentStore?.currency_code;
  return formatStoreMoney(amount, code, language);
}

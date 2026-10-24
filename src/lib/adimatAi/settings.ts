import type { AiSettings } from './types';

export const AI_SETTINGS_KEY = 'adimat-ai-settings';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  expiryDays: 30,
  deadStockWeeks: 8,
  restockWeeks: 6,
  leadTimeDays: 7,
  coverDays: 7,
  openingHour: 8,
  closingHour: 20,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeAiSettings(value: unknown): AiSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<AiSettings>) : {};
  const openingHour = clampInt(raw.openingHour, 0, 23, DEFAULT_AI_SETTINGS.openingHour);
  let closingHour = clampInt(raw.closingHour, 1, 24, DEFAULT_AI_SETTINGS.closingHour);
  if (closingHour <= openingHour) closingHour = Math.min(24, openingHour + 1);
  return {
    expiryDays: clampInt(raw.expiryDays, 1, 180, DEFAULT_AI_SETTINGS.expiryDays),
    deadStockWeeks: clampInt(raw.deadStockWeeks, 2, 26, DEFAULT_AI_SETTINGS.deadStockWeeks),
    restockWeeks: clampInt(raw.restockWeeks, 4, 8, DEFAULT_AI_SETTINGS.restockWeeks),
    leadTimeDays: clampInt(raw.leadTimeDays, 1, 60, DEFAULT_AI_SETTINGS.leadTimeDays),
    coverDays: clampInt(raw.coverDays, 1, 60, DEFAULT_AI_SETTINGS.coverDays),
    openingHour,
    closingHour,
  };
}

export function readAiSettings(storage?: Pick<Storage, 'getItem'>): AiSettings {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!source) return { ...DEFAULT_AI_SETTINGS };
    const raw = source.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    return normalizeAiSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function writeAiSettings(settings: AiSettings, storage?: Pick<Storage, 'setItem'>): AiSettings {
  const next = normalizeAiSettings(settings);
  const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  source?.setItem(AI_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

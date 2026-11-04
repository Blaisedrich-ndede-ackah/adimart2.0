import type { Pair } from './types';

const PREFIX = 'adimat-ai-pairs:';

export interface PairCache {
  storeId: string;
  pairs: Pair[];
  names: Record<string, string>;
  savedAt: string;
}

export function writePairCache(storeId: string, pairs: Pair[], names: Record<string, string>): void {
  if (typeof localStorage === 'undefined' || !storeId) return;
  const payload: PairCache = { storeId, pairs, names, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(PREFIX + storeId, JSON.stringify(payload));
  } catch {
    // The till still works if the browser refuses the extra cache.
  }
}

export function readPairCache(storeId: string | null | undefined): PairCache | null {
  if (typeof localStorage === 'undefined' || !storeId) return null;
  try {
    const raw = localStorage.getItem(PREFIX + storeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PairCache;
    if (!parsed || parsed.storeId !== storeId || !Array.isArray(parsed.pairs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

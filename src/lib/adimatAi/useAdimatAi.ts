import { useEffect, useState } from 'react';
import { suggestBoughtTogether, type AlsoBuySuggestion } from './boughtTogether';
import { readPairCache, type PairCache } from './pairCache';
import { readAiSettings, writeAiSettings } from './settings';
import { refreshAdimatAi } from './runtime';
import type { AiReport, AiSettings } from './types';

export interface AdimatAiState {
  report: AiReport | null;
  locations: { id: string; name: string }[];
  locationId: string | null;
  setLocationId: (locationId: string) => void;
  settings: AiSettings;
  setSettings: (settings: AiSettings) => void;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  refresh: () => void;
}

export function useAdimatAi(storeId: string | undefined, isOwner: boolean): AdimatAiState {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [resolvedLocationId, setResolvedLocationId] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<AiSettings>(() => readAiSettings());
  const [report, setReport] = useState<AiReport | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<AdimatAiState['status']>('idle');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setStatus('loading');
    setError('');
    void refreshAdimatAi({
      storeId,
      locationId,
      includeSensitive: isOwner,
      settings,
    })
      .then((result) => {
        if (!active) return;
        setReport(result.report);
        setLocations(result.locations);
        setResolvedLocationId(result.locationId);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'ADIMAT AI could not read this shop.');
      });
    return () => {
      active = false;
    };
  }, [storeId, locationId, isOwner, settings, tick]);

  return {
    report,
    locations,
    locationId: locationId ?? resolvedLocationId,
    setLocationId,
    settings,
    setSettings: (next) => setSettingsState(writeAiSettings(next)),
    status,
    error,
    refresh: () => setTick((value) => value + 1),
  };
}

export function useAlsoBuy(storeId: string | undefined, cartIds: string[]): AlsoBuySuggestion[] {
  const [cache, setCache] = useState<PairCache | null>(null);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    void refreshAdimatAi({ storeId, includeSensitive: false })
      .then(() => {
        if (active) setCache(readPairCache(storeId));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [storeId]);
  return suggestBoughtTogether(cache?.pairs || [], cache?.names || {}, cartIds, 3);
}

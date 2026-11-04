import AiWorker from './worker?worker&inline';
import { runReportBatched } from './engine';
import { loadAiSnapshot } from './load';
import { writePairCache } from './pairCache';
import type { AiReport, AiSettings, AiSnapshot } from './types';

export interface RefreshInput {
  storeId: string;
  locationId?: string | null;
  includeSensitive: boolean;
  settings?: AiSettings;
}

export interface RefreshResult {
  report: AiReport;
  locations: { id: string; name: string }[];
  locationId: string | null;
}

const inflight = new Map<string, Promise<RefreshResult>>();

function pauseForIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 0);
  });
}

function runInWorker(snapshot: AiSnapshot, includeSensitive: boolean): Promise<AiReport> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new AiWorker();
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('ADIMAT AI worker timed out.'));
    }, 8000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; report?: AiReport; error?: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data?.ok && event.data.report) resolve(event.data.report);
      else reject(new Error(event.data?.error || 'ADIMAT AI worker failed.'));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error('ADIMAT AI worker failed.'));
    };
    worker.postMessage({ snapshot, includeSensitive });
  });
}

export async function refreshAdimatAi(input: RefreshInput): Promise<RefreshResult> {
  const key = `${input.storeId}|${input.locationId || ''}|${input.includeSensitive}|${JSON.stringify(input.settings || {})}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const job = compute(input).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function compute(input: RefreshInput): Promise<RefreshResult> {
  await pauseForIdle();
  const loaded = await loadAiSnapshot(input);
  let report: AiReport;
  try {
    report = await runInWorker(loaded.snapshot, input.includeSensitive);
  } catch {
    report = await runReportBatched(loaded.snapshot, { includeSensitive: input.includeSensitive }, pauseForIdle);
  }
  writePairCache(input.storeId, report.pairs, report.productNames);
  return { report, locations: loaded.locations, locationId: loaded.locationId };
}

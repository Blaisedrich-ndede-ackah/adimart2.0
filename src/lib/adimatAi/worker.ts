import { runReport } from './engine';
import type { AiReport, AiSnapshot } from './types';

interface WorkerRequest {
  snapshot: AiSnapshot;
  includeSensitive: boolean;
}

interface WorkerResponse {
  ok: boolean;
  report?: AiReport;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = (event) => {
  try {
    const report = runReport(event.data.snapshot, { includeSensitive: event.data.includeSensitive });
    scope.postMessage({ ok: true, report });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : 'ADIMAT AI could not finish.' });
  }
};

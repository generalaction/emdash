import type { UsageSnapshot } from '@shared/usage';
import { runPipeline } from './pipeline';
import { setRemoteRates, type ModelRate } from './pricing';

/**
 * utilityProcess worker entry. Runs the synchronous scan/read/parse/aggregate pass off the
 * Electron main process so a cold cache (potentially GBs of JSONL) never freezes the UI. The
 * main process forwards the models.dev rate map (this is a separate process with its own pricing
 * module state) and we reply with the finished snapshot — small, so the cross-process copy is cheap.
 */
type Request = { indexPath: string; rates: Array<[string, ModelRate]>; nowISO: string };
export type WorkerResponse = { ok: true; snapshot: UsageSnapshot } | { ok: false; error: string };

process.parentPort.on('message', (e) => {
  const { indexPath, rates, nowISO } = e.data as Request;
  let res: WorkerResponse;
  try {
    setRemoteRates(new Map(rates));
    res = { ok: true, snapshot: runPipeline(indexPath, new Date(nowISO)) };
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage(res);
});

import { runPipeline } from './pipeline';
import { setRemoteRates } from './pricing';
import type { WorkerRequest, WorkerResponse } from './worker-request';

/**
 * utilityProcess worker entry. Runs the synchronous scan/read/parse/aggregate pass off the
 * Electron main process so a cold cache (potentially GBs of JSONL) never freezes the UI. The
 * main process forwards the models.dev rate map (this is a separate process with its own pricing
 * module state) and we reply with the finished snapshot — small, so the cross-process copy is cheap.
 */
process.parentPort.on('message', (e) => {
  const { reqId, indexPath, rates, nowISO } = e.data as WorkerRequest;
  let res: WorkerResponse;
  try {
    setRemoteRates(new Map(rates));
    res = { reqId, ok: true, snapshot: runPipeline(indexPath, new Date(nowISO)) };
  } catch (err) {
    res = { reqId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage(res);
});

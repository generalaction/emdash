import type { UsageSnapshot } from '@shared/usage';
import type { ModelRate } from './pricing';

export type WorkerRequest = {
  reqId: number;
  indexPath: string;
  rates: Array<[string, ModelRate]>;
  nowISO: string;
};
export type WorkerResponse = { reqId: number } & (
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; error: string }
);

/** The slice of Electron's UtilityProcess this helper needs — kept structural so tests can fake it. */
export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (res: WorkerResponse) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  off(event: 'message', listener: (res: WorkerResponse) => void): unknown;
  off(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
};

let nextReqId = 1;

/**
 * Send one compute request and await its response. Hardened against two failure modes:
 * a response carrying a different reqId is ignored (it belongs to an earlier, timed-out
 * request — consuming it would resolve with a stale snapshot), and on timeout the worker
 * is killed so the service respawns a fresh one instead of reusing a wedged process.
 */
export function requestSnapshot(
  worker: WorkerLike,
  payload: Omit<WorkerRequest, 'reqId'>,
  timeoutMs: number
): Promise<UsageSnapshot> {
  const reqId = nextReqId++;
  return new Promise<UsageSnapshot>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
    };
    const onMessage = (res: WorkerResponse): void => {
      if (res.reqId !== reqId) return; // stale response from a previous request
      cleanup();
      if (res.ok) resolve(res.snapshot);
      else reject(new Error(res.error));
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`usage worker exited (${code}) before responding`));
    };
    const timer = setTimeout(() => {
      cleanup();
      worker.kill(); // wedged: make the service respawn next time
      reject(new Error('usage worker timed out'));
    }, timeoutMs);

    worker.on('message', onMessage);
    worker.on('exit', onExit);
    worker.postMessage({ ...payload, reqId });
  });
}

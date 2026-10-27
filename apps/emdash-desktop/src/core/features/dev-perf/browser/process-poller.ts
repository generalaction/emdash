import type { DevPerfProcess } from '../api/contract';

export const PROCESS_POLL_INTERVAL_MS = 1_000;

export type ProcessSnapshotResult = {
  supported: boolean;
  processes: DevPerfProcess[];
};

export type ProcessPollerOptions = {
  fetchSnapshot(): Promise<ProcessSnapshotResult>;
  onSnapshot(snapshot: ProcessSnapshotResult): void;
  intervalMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

/**
 * Poll the main process's `ps` snapshot while the process panel is open.
 * Fetches immediately, then re-fetches `intervalMs` after each response lands
 * (no overlapping requests); `stop()` cancels the pending timer and drops any
 * in-flight response so nothing runs once the panel closes.
 */
export function createProcessPoller(options: ProcessPollerOptions): { stop(): void } {
  const intervalMs = options.intervalMs ?? PROCESS_POLL_INTERVAL_MS;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    let snapshot: ProcessSnapshotResult | null = null;
    try {
      snapshot = await options.fetchSnapshot();
    } catch {
      // Transient RPC failure; keep polling.
    }
    if (stopped) return;
    if (snapshot) options.onSnapshot(snapshot);
    timer = setTimer(() => void tick(), intervalMs);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

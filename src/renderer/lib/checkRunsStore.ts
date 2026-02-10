import type { CheckRunsStatus, CheckRun } from './checkRunStatus';
import { buildCheckRunsStatus } from './checkRunStatus';

type Listener = (status: CheckRunsStatus | null) => void;

const cache = new Map<string, CheckRunsStatus | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<CheckRunsStatus | null>>();

async function fetchCheckRuns(taskPath: string): Promise<CheckRunsStatus | null> {
  try {
    const res = await window.electronAPI.getCheckRuns({ taskPath });
    if (res?.success && res.checks) {
      return buildCheckRunsStatus(res.checks as CheckRun[]);
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshCheckRuns(taskPath: string): Promise<CheckRunsStatus | null> {
  const inFlight = pending.get(taskPath);
  if (inFlight) return inFlight;

  const promise = fetchCheckRuns(taskPath);
  pending.set(taskPath, promise);

  try {
    const status = await promise;
    cache.set(taskPath, status);

    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      for (const listener of taskListeners) {
        try {
          listener(status);
        } catch {}
      }
    }

    return status;
  } finally {
    pending.delete(taskPath);
  }
}

export async function refreshAllSubscribedCheckRuns(): Promise<void> {
  const paths = Array.from(listeners.keys());
  await Promise.all(paths.map(refreshCheckRuns));
}

export function subscribeToCheckRuns(taskPath: string, listener: Listener): () => void {
  const set = listeners.get(taskPath) || new Set<Listener>();
  set.add(listener);
  listeners.set(taskPath, set);

  const cached = cache.get(taskPath);
  if (cached !== undefined) {
    try {
      listener(cached);
    } catch {}
  }

  if (!cache.has(taskPath) && !pending.has(taskPath)) {
    refreshCheckRuns(taskPath);
  }

  return () => {
    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      taskListeners.delete(listener);
      if (taskListeners.size === 0) {
        listeners.delete(taskPath);
        cache.delete(taskPath);
      }
    }
  };
}

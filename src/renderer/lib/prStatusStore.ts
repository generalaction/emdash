import type { PrInfo } from './prStatus';

type PrData = PrInfo & {
  mergeStateStatus?: string;
  headRefName?: string;
  baseRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

type Listener = (pr: PrData | null) => void;

const cache = new Map<string, PrData | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<PrData | null>>();

async function fetchPrStatus(taskPath: string): Promise<PrData | null> {
  try {
    const res = await window.electronAPI.getPrStatus({ taskPath });
    if (res?.success && res.pr) {
      return res.pr as PrData;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function refreshPrStatus(taskPath: string): Promise<PrData | null> {
  // Deduplicate concurrent requests
  const inFlight = pending.get(taskPath);
  if (inFlight) return inFlight;

  const promise = fetchPrStatus(taskPath);
  pending.set(taskPath, promise);

  try {
    const pr = await promise;
    cache.set(taskPath, pr);

    // Notify all listeners
    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      for (const listener of taskListeners) {
        try {
          listener(pr);
        } catch {}
      }
    }

    return pr;
  } finally {
    pending.delete(taskPath);
  }
}

export function subscribeToPrStatus(taskPath: string, listener: Listener): () => void {
  const set = listeners.get(taskPath) || new Set<Listener>();
  set.add(listener);
  listeners.set(taskPath, set);

  // Emit current cached value if available
  const cached = cache.get(taskPath);
  if (cached !== undefined) {
    try {
      listener(cached);
    } catch {}
  }

  // Trigger fetch if not cached
  if (!cache.has(taskPath) && !pending.has(taskPath)) {
    refreshPrStatus(taskPath);
  }

  return () => {
    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      taskListeners.delete(listener);
      if (taskListeners.size === 0) {
        listeners.delete(taskPath);
      }
    }
  };
}

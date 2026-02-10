import type { PrCommentsStatus } from './prCommentsStatus';
import { buildPrCommentsStatus } from './prCommentsStatus';

type Listener = (status: PrCommentsStatus | null) => void;

const cache = new Map<string, PrCommentsStatus | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<PrCommentsStatus | null>>();
const prNumbers = new Map<string, number>();

async function fetchPrComments(taskPath: string): Promise<PrCommentsStatus | null> {
  try {
    const prNumber = prNumbers.get(taskPath);
    const res = await window.electronAPI.getPrComments({ taskPath, prNumber });
    if (res?.success) {
      return buildPrCommentsStatus(res.comments || [], res.reviews || []);
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshPrComments(taskPath: string): Promise<PrCommentsStatus | null> {
  const inFlight = pending.get(taskPath);
  if (inFlight) return inFlight;

  const promise = fetchPrComments(taskPath);
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

export function subscribeToPrComments(
  taskPath: string,
  prNumber: number | undefined,
  listener: Listener
): () => void {
  if (prNumber) prNumbers.set(taskPath, prNumber);

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
    refreshPrComments(taskPath);
  }

  return () => {
    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      taskListeners.delete(listener);
      if (taskListeners.size === 0) {
        listeners.delete(taskPath);
        cache.delete(taskPath);
        prNumbers.delete(taskPath);
      }
    }
  };
}

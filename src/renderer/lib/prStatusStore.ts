import type { PrStatus } from './prStatus';

type Listener = (pr: PrStatus | null, isLoading: boolean) => void;

const cache = new Map<string, PrStatus | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<PrStatus | null>>();

async function fetchPrStatus(taskPath: string): Promise<PrStatus | null> {
  try {
    const res = await window.electronAPI.getPrStatus({ taskPath });
    if (res?.success && res.pr) {
      return res.pr as PrStatus;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function notifyListeners(taskPath: string, pr: PrStatus | null, isLoading: boolean) {
  const taskListeners = listeners.get(taskPath);
  if (taskListeners) {
    for (const listener of taskListeners) {
      try {
        listener(pr, isLoading);
      } catch {}
    }
  }
}

export async function refreshPrStatus(taskPath: string): Promise<PrStatus | null> {
  // Deduplicate concurrent requests
  const inFlight = pending.get(taskPath);
  if (inFlight) return inFlight;

  // Verify we actually need to change state before notifying
  const cached = cache.get(taskPath);
  notifyListeners(taskPath, cached ?? null, !cache.has(taskPath));

  const promise = fetchPrStatus(taskPath);
  pending.set(taskPath, promise);

  try {
    const pr = await promise;
    cache.set(taskPath, pr);
    notifyListeners(taskPath, pr, false);
    return pr;
  } finally {
    pending.delete(taskPath);
  }
}

/**
 * Refresh PR status for all currently subscribed task paths.
 * Used on window focus to update all visible PR buttons.
 */
export async function refreshAllSubscribedPrStatus(): Promise<void> {
  const paths = Array.from(listeners.keys());
  await Promise.all(paths.map(refreshPrStatus));
}

export function subscribeToPrStatus(taskPath: string, listener: Listener): () => void {
  const set = listeners.get(taskPath) || new Set<Listener>();
  set.add(listener);
  listeners.set(taskPath, set);

  // Emit current cached value if available
  const cached = cache.get(taskPath);
  const isPending = pending.has(taskPath);

  if (cached !== undefined) {
    try {
      listener(cached, false);
    } catch {}
  } else if (isPending) {
    // If pending but no cache (first load), emit undefined pr with loading=true
    try {
      listener(null, true);
    } catch {}
  }

  // Trigger fetch if not cached and not pending
  if (!cache.has(taskPath) && !pending.has(taskPath)) {
    refreshPrStatus(taskPath);
  }

  return () => {
    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      taskListeners.delete(listener);
      if (taskListeners.size === 0) {
        listeners.delete(taskPath);
        cache.delete(taskPath); // Clear cache when no subscribers
      }
    }
  };
}

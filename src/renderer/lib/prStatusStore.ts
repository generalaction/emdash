import type { PrStatus } from './prStatus';

const STORAGE_KEY_PREFIX = 'emdash:pr:';

type Listener = (pr: PrStatus | null, isLoading: boolean) => void;

const cache = new Map<string, PrStatus | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<PrStatus | null>>();

function getStoredPr(taskPath: string): PrStatus | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + taskPath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrStatus;
    if (parsed && (parsed.number != null || parsed.url)) return parsed;
  } catch {}
  return null;
}

function setStoredPr(taskPath: string, pr: PrStatus | null) {
  try {
    if (pr) {
      localStorage.setItem(STORAGE_KEY_PREFIX + taskPath, JSON.stringify(pr));
    } else {
      localStorage.removeItem(STORAGE_KEY_PREFIX + taskPath);
    }
  } catch {}
}

async function fetchPrStatus(
  taskPath: string
): Promise<{ pr: PrStatus | null; success: boolean }> {
  try {
    const res = await window.electronAPI.getPrStatus({ taskPath });
    if (res?.success) {
      return { pr: (res.pr as PrStatus) ?? null, success: true };
    }
    return { pr: null, success: false };
  } catch {
    return { pr: null, success: false };
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
    const { pr, success } = await promise;
    if (success) {
      cache.set(taskPath, pr);
      setStoredPr(taskPath, pr);
      notifyListeners(taskPath, pr, false);
      return pr;
    }
    const inMemory = cache.get(taskPath);
    const kept = inMemory ?? getStoredPr(taskPath);
    if (kept != null && !cache.has(taskPath)) {
      cache.set(taskPath, kept);
    }
    notifyListeners(taskPath, kept ?? null, false);
    return kept ?? null;
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

  const cached = cache.get(taskPath);
  const isPending = pending.has(taskPath);

  if (cached !== undefined) {
    try {
      listener(cached, false);
    } catch {}
  } else {
    const stored = getStoredPr(taskPath);
    if (stored) {
      try {
        listener(stored, false);
      } catch {}
      cache.set(taskPath, stored);
    } else {
      try {
        listener(null, true);
      } catch {}
    }
  }

  if (!pending.has(taskPath)) {
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

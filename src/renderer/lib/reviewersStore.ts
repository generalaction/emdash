import type { Reviewer } from './reviewersStatus';
import { buildReviewers } from './reviewersStatus';

type Listener = (reviewers: Reviewer[]) => void;

const cache = new Map<string, Reviewer[]>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, Promise<Reviewer[]>>();

async function fetchReviewers(taskPath: string): Promise<Reviewer[]> {
  try {
    const res = await window.electronAPI.getPrReviewers({ taskPath });
    if (res?.success) {
      return buildReviewers(res.reviewRequests || [], res.reviews || []);
    }
    return [];
  } catch {
    return [];
  }
}

export async function refreshReviewers(taskPath: string): Promise<Reviewer[]> {
  const inFlight = pending.get(taskPath);
  if (inFlight) return inFlight;

  const promise = fetchReviewers(taskPath);
  pending.set(taskPath, promise);

  try {
    const reviewers = await promise;
    cache.set(taskPath, reviewers);

    const taskListeners = listeners.get(taskPath);
    if (taskListeners) {
      for (const listener of taskListeners) {
        try {
          listener(reviewers);
        } catch {}
      }
    }

    return reviewers;
  } finally {
    pending.delete(taskPath);
  }
}

export function subscribeToReviewers(taskPath: string, listener: Listener): () => void {
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
    refreshReviewers(taskPath);
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

export function invalidateReviewers(taskPath: string): void {
  cache.delete(taskPath);
}

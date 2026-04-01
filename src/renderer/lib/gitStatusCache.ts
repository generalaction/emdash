export type GitStatusChange = {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  isStaged: boolean;
  diff?: string;
};

export type GitStatusResult = {
  success: boolean;
  changes?: GitStatusChange[];
  error?: string;
};

const CACHE_TTL_MS = 30000;

const cache = new Map<string, { timestamp: number; result: GitStatusResult }>();
const inFlight = new Map<string, { id: number; promise: Promise<GitStatusResult> }>();
const latestRequestId = new Map<string, number>();
let requestCounter = 0;

type RevalidateListener = (cacheKey: string, result: GitStatusResult) => void;
const revalidateListeners = new Set<RevalidateListener>();

/**
 * Returns git status for a worktree with caching and stale-while-revalidate.
 *
 * - Fresh cache (< TTL): returns immediately, no IPC call.
 * - Stale cache (>= TTL): returns stale data immediately, starts a background
 *   refresh that updates the cache and notifies listeners when done.
 * - No cache: blocks on the IPC call.
 * - force: true: bypasses cache and always makes an IPC call.
 */
export async function getCachedGitStatus(
  taskPath: string,
  options?: { force?: boolean; taskId?: string; includeUntracked?: boolean }
): Promise<GitStatusResult> {
  if (!taskPath) return { success: false, error: 'workspace-unavailable' };
  const force = options?.force ?? false;
  const taskId = options?.taskId;
  const includeUntracked = options?.includeUntracked ?? true;
  const cacheKey = buildCacheKey(taskPath, taskId, includeUntracked);
  const now = Date.now();

  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    // Stale: return immediately, refresh in background.
    // Bump timestamp to prevent idle-loop spinning.
    if (cached) {
      cache.set(cacheKey, { timestamp: now, result: cached.result });
      if (!inFlight.has(cacheKey)) {
        startFetch(cacheKey, taskPath, taskId, includeUntracked, true);
      }
      return cached.result;
    }
  }

  const existing = inFlight.get(cacheKey);
  if (!force && existing) return existing.promise;

  return startFetch(cacheKey, taskPath, taskId, includeUntracked);
}

/**
 * Subscribe to background cache revalidation completions.
 * Called when a stale-while-revalidate background fetch finishes (success or
 * failure), allowing the UI to update without polling.
 */
export function onCacheRevalidated(listener: RevalidateListener): () => void {
  revalidateListeners.add(listener);
  return () => {
    revalidateListeners.delete(listener);
  };
}

function notifyRevalidated(cacheKey: string, result: GitStatusResult) {
  for (const listener of revalidateListeners) {
    listener(cacheKey, result);
  }
}

export function buildCacheKey(
  taskPath: string,
  taskId?: string,
  includeUntracked?: boolean
): string {
  let key = taskId ? `${taskPath}::${taskId}` : taskPath;
  if (includeUntracked === false) key += '::tracked';
  return key;
}

export function getCachedResult(
  taskPath: string,
  taskId?: string
): { result: GitStatusResult; isStale: boolean } | undefined {
  const cacheKey = buildCacheKey(taskPath, taskId);
  const entry = cache.get(cacheKey);
  if (!entry) return undefined;
  return { result: entry.result, isStale: Date.now() - entry.timestamp >= CACHE_TTL_MS };
}

/**
 * @param notify When true (stale-while-revalidate path), notifies revalidation
 *   listeners on completion. On failure, preserves the existing cache entry.
 */
function startFetch(
  cacheKey: string,
  taskPath: string,
  taskId?: string,
  includeUntracked?: boolean,
  notify = false
): Promise<GitStatusResult> {
  const requestId = (requestCounter += 1);
  latestRequestId.set(cacheKey, requestId);
  const promise = (async () => {
    try {
      const res = await window.electronAPI.getGitStatus({
        taskPath,
        taskId,
        includeUntracked,
      });
      const result = res ?? {
        success: false,
        error: 'Failed to load git status',
      };
      if (latestRequestId.get(cacheKey) === requestId) {
        cache.set(cacheKey, { timestamp: Date.now(), result });
        if (notify) notifyRevalidated(cacheKey, result);
      }
      return result;
    } catch (error) {
      const result = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load git status',
      };
      if (latestRequestId.get(cacheKey) === requestId) {
        // Never overwrite a known-good cache entry with a failure —
        // stale data is more useful than an error on remount.
        const existing = cache.get(cacheKey);
        if (!existing?.result?.success) {
          cache.set(cacheKey, { timestamp: Date.now(), result });
        }
        if (notify) notifyRevalidated(cacheKey, result);
      }
      return result;
    } finally {
      const current = inFlight.get(cacheKey);
      if (current?.id === requestId) {
        inFlight.delete(cacheKey);
      }
    }
  })();

  inFlight.set(cacheKey, { id: requestId, promise });
  return promise;
}

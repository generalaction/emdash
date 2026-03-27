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

export async function getCachedGitStatus(
  taskPath: string,
  options?: { force?: boolean; taskId?: string }
): Promise<GitStatusResult> {
  if (!taskPath) return { success: false, error: 'workspace-unavailable' };
  const force = options?.force ?? false;
  const taskId = options?.taskId;
  // Use a composite key when taskId is present so workspace status
  // doesn't collide with local project status for the same taskPath.
  const cacheKey = taskId ? `${taskPath}::${taskId}` : taskPath;
  const now = Date.now();

  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const existing = inFlight.get(cacheKey);
  if (!force && existing) return existing.promise;

  const requestId = (requestCounter += 1);
  latestRequestId.set(cacheKey, requestId);
  const promise = (async () => {
    try {
      const res = await window.electronAPI.getGitStatus(taskId ? { taskPath, taskId } : taskPath);
      const result = res ?? {
        success: false,
        error: 'Failed to load git status',
      };
      if (latestRequestId.get(cacheKey) === requestId) {
        cache.set(cacheKey, { timestamp: Date.now(), result });
      }
      return result;
    } catch (error) {
      const result = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load git status',
      };
      if (latestRequestId.get(cacheKey) === requestId) {
        cache.set(cacheKey, { timestamp: Date.now(), result });
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

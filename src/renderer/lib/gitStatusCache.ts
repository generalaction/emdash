export type GitStatusChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
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
  options?: { force?: boolean }
): Promise<GitStatusResult> {
  if (!taskPath) return { success: false, error: 'workspace-unavailable' };
  const force = options?.force ?? false;
  const now = Date.now();

  if (!force) {
    const cached = cache.get(taskPath);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const existing = inFlight.get(taskPath);
  if (!force && existing) return existing.promise;

  const requestId = (requestCounter += 1);
  latestRequestId.set(taskPath, requestId);
  const promise = (async () => {
    try {
      const res = await window.electronAPI.getGitStatus(taskPath);
      const result = res ?? {
        success: false,
        error: 'Failed to load git status',
      };
      if (latestRequestId.get(taskPath) === requestId) {
        cache.set(taskPath, { timestamp: Date.now(), result });
      }
      return result;
    } catch (error) {
      const result = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load git status',
      };
      if (latestRequestId.get(taskPath) === requestId) {
        cache.set(taskPath, { timestamp: Date.now(), result });
      }
      return result;
    } finally {
      const current = inFlight.get(taskPath);
      if (current?.id === requestId) {
        inFlight.delete(taskPath);
      }
    }
  })();

  inFlight.set(taskPath, { id: requestId, promise });
  return promise;
}

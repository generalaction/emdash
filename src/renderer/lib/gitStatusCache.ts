export type GitStatusChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
};

export type GitStatusResult = {
  success: boolean;
  changes?: GitStatusChange[];
  error?: string;
};

const CACHE_TTL_MS = 30000;

const cache = new Map<string, { timestamp: number; result: GitStatusResult }>();
const inFlight = new Map<string, Promise<GitStatusResult>>();

export async function getCachedGitStatus(
  workspacePath: string,
  options?: { force?: boolean },
): Promise<GitStatusResult> {
  if (!workspacePath) return { success: false, error: "workspace-unavailable" };
  const force = options?.force ?? false;
  const now = Date.now();

  if (!force) {
    const cached = cache.get(workspacePath);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.result;
  }

  const existing = inFlight.get(workspacePath);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await window.electronAPI.getGitStatus(workspacePath);
      const result = res ?? {
        success: false,
        error: "Failed to load git status",
      };
      cache.set(workspacePath, { timestamp: Date.now(), result });
      return result;
    } catch (error) {
      const result = {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load git status",
      };
      cache.set(workspacePath, { timestamp: Date.now(), result });
      return result;
    } finally {
      inFlight.delete(workspacePath);
    }
  })();

  inFlight.set(workspacePath, promise);
  return promise;
}

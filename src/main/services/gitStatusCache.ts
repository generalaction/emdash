type GitStatusCacheEntry<T> = {
  expiresAt: number;
  value?: T;
  inFlight?: Promise<T>;
};

const DEFAULT_TTL_MS = 3000;
const gitStatusCache = new Map<string, GitStatusCacheEntry<unknown>>();

export async function getCachedGitStatus<T>(
  taskPath: string,
  compute: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();
  const entry = gitStatusCache.get(taskPath) as GitStatusCacheEntry<T> | undefined;

  if (entry) {
    if (entry.value && entry.expiresAt > now) {
      return entry.value;
    }
    if (entry.inFlight) {
      return entry.inFlight;
    }
  }

  const inFlight = compute()
    .then((value) => {
      gitStatusCache.set(taskPath, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      const current = gitStatusCache.get(taskPath);
      if (current?.inFlight === inFlight) {
        gitStatusCache.delete(taskPath);
      }
      throw error;
    });

  gitStatusCache.set(taskPath, {
    expiresAt: 0,
    inFlight,
  });

  return inFlight;
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_BRANCH_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  defaultBranch: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

export async function getDefaultBranchCached(repoPath: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(repoPath);
  if (cached && cached.expiresAt > now && cached.defaultBranch) {
    return cached.defaultBranch;
  }

  const existing = inFlight.get(repoPath);
  if (existing) return existing;

  const promise = resolveDefaultBranch(repoPath)
    .then((branch) => {
      cache.set(repoPath, {
        defaultBranch: branch,
        expiresAt: Date.now() + DEFAULT_BRANCH_TTL_MS,
      });
      inFlight.delete(repoPath);
      return branch;
    })
    .catch((error) => {
      inFlight.delete(repoPath);
      throw error;
    });

  inFlight.set(repoPath, promise);
  return promise;
}

async function resolveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
      { cwd: repoPath }
    );
    const db = (stdout || '').trim();
    if (db) return db;
  } catch {}

  try {
    const { stdout } = await execAsync('git remote show origin | sed -n "/HEAD branch/s/.*: //p"', {
      cwd: repoPath,
    });
    const db2 = (stdout || '').trim();
    if (db2) return db2;
  } catch {}

  return 'main';
}

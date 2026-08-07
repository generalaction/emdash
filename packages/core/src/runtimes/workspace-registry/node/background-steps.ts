import type { BoundExec } from '#services/exec/api';
import { createRegistryGitExec } from './scan/observe-git';

export type BackgroundStepOutcome =
  | { status: 'succeeded' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; message: string };

/**
 * The push-branch background step: one attempt in the parent repository, outside the
 * per-repository creation mutex (git ref locking handles overlap). Failure becomes a
 * durable "branch not pushed" state with a manual retry — never an automatic loop.
 */
export async function executePushBranch(input: {
  repositoryPath: string;
  branch: string;
}): Promise<BackgroundStepOutcome> {
  const exec = createRegistryGitExec(input.repositoryPath, {
    tier: 'background',
    repository: input.repositoryPath,
  });
  try {
    const remote = await defaultRemote(exec);
    if (!remote) {
      return { status: 'failed', message: 'Repository has no remote to push to' };
    }
    await exec.exec(['push', '-u', remote, input.branch]);
    return { status: 'succeeded' };
  } catch (error) {
    return { status: 'failed', message: describe(error) };
  }
}

/**
 * The fetch-refs background step: freshens the base remote's tracking refs so the next
 * creation's resolve-base finds a recent base. Advisory — the outcome is recorded but
 * a failure (offline) never surfaces as an error. Base remote only; never --all.
 */
export async function executeFetchRefs(input: {
  repositoryPath: string;
  baseRef: string;
}): Promise<BackgroundStepOutcome> {
  const exec = createRegistryGitExec(input.repositoryPath, {
    tier: 'background',
    repository: input.repositoryPath,
  });
  try {
    const remotes = (await exec.exec(['remote'])).stdout.trim().split('\n').filter(Boolean);
    if (remotes.length === 0) {
      return { status: 'skipped', reason: 'Repository has no remotes' };
    }
    const separator = input.baseRef.indexOf('/');
    const candidate = separator > 0 ? input.baseRef.slice(0, separator) : null;
    const remote =
      candidate !== null && remotes.includes(candidate)
        ? candidate
        : remotes.includes('origin')
          ? 'origin'
          : remotes[0]!;
    // Hygiene (spec: git concurrency model): freshen tracking refs without a
    // FETCH_HEAD write or an auto-maintenance child racing other operations.
    await exec.exec(['fetch', remote, '--prune', '--no-write-fetch-head', '--no-auto-maintenance']);
    return { status: 'succeeded' };
  } catch (error) {
    return { status: 'failed', message: describe(error) };
  }
}

async function defaultRemote(exec: BoundExec): Promise<string | null> {
  const remotes = (await exec.exec(['remote'])).stdout.trim().split('\n').filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] ?? null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

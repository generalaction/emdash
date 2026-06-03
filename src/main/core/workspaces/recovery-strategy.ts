import { log } from '@main/lib/logger';
import type { SetupStepError } from '@shared/workspace-setup-steps';
import type { StepContext } from './setup-steps/step-context';

export type RecoveryOutcome =
  | { kind: 'resolved'; path: string }
  | { kind: 'retry' }
  | { kind: 'failed'; error: SetupStepError };

/**
 * Attempts to recover from a `SetupStepError` returned by the executor.
 *
 * - `branch-already-checked-out` → search for the worktree path and adopt it.
 * - `stale-directory` → remove the directory and prune worktrees, then retry.
 * - All other errors → propagate as failed (no recovery possible).
 */
export async function applyRecovery(
  error: SetupStepError,
  ctx: StepContext
): Promise<RecoveryOutcome> {
  if (error.kind === 'add-worktree' && error.type === 'branch-already-checked-out') {
    const { branchName, candidatePath } = error;

    // Try the hint path first, then search all worktrees.
    const path = candidatePath ?? (await findBranchAnywhere(branchName, ctx));

    if (path) {
      log.info('recovery-strategy: branch already checked out elsewhere — adopting path', {
        branchName,
        path,
      });
      return { kind: 'resolved', path };
    }

    // Cannot locate the branch — treat as unrecoverable.
    log.warn('recovery-strategy: branch-already-checked-out but cannot find path', { branchName });
    return { kind: 'failed', error };
  }

  if (error.kind === 'add-worktree' && error.type === 'stale-directory') {
    const { path } = error;
    log.info('recovery-strategy: stale directory — removing and pruning', { path });

    try {
      await ctx.host.removeAbsolute(path, { recursive: true });
      await ctx.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      return { kind: 'retry' };
    } catch (removeError) {
      log.warn('recovery-strategy: failed to remove stale directory', {
        path,
        error: String(removeError),
      });
      return { kind: 'failed', error };
    }
  }

  return { kind: 'failed', error };
}

async function findBranchAnywhere(
  branchName: string,
  ctx: StepContext
): Promise<string | undefined> {
  try {
    const { stdout } = await ctx.ctx.exec('git', ['worktree', 'list', '--porcelain']);
    const branchLine = `branch refs/heads/${branchName}`;
    for (const block of stdout.split('\n\n')) {
      if (!block.split('\n').some((line) => line === branchLine)) continue;
      const match = /^worktree (.+)$/m.exec(block);
      const candidatePath = match?.[1];
      if (!candidatePath) continue;
      const gitFile = ctx.host.pathApi.join(candidatePath, '.git');
      if (await ctx.host.existsAbsolute(gitFile)) return candidatePath;
    }
  } catch {}
  return undefined;
}

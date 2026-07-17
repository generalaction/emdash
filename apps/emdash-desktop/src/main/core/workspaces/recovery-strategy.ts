import type { SetupStepError } from '@core/primitives/workspaces/api/workspace-setup-steps';
import { log } from '@main/lib/logger';
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
    const path = candidatePath ?? (await ctx.worktreeService.findBranchAnywhere(branchName));

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
      await ctx.worktreeService.removeWorktree(path);
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

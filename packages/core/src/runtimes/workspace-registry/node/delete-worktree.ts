import { promises as fs } from 'node:fs';
import { createRegistryGitExec } from './scan/observe-git';
import { validateWorktreePath } from './worktree-path-safety';

export type DeleteWorktreeExecution = {
  repositoryPath: string;
  worktreePath: string;
  deleteBranch: boolean;
  /** Fallback branch name when the worktree is already gone from disk. */
  branchHint: string | null;
};

export type DeleteWorktreeExecutionResult =
  | { status: 'succeeded' }
  | { status: 'failed'; message: string };

/**
 * Force-removes the worktree artifact (and optionally its branch). No dirty/unpushed
 * refusals by design — informed confirmation happens client-side from mirror
 * observations; the host executes what it is told. Path safety still applies: only
 * worktrees owned by the parent repository are removable.
 */
export async function executeDeleteWorktree(
  execution: DeleteWorktreeExecution
): Promise<DeleteWorktreeExecutionResult> {
  const exec = createRegistryGitExec(execution.repositoryPath);

  const safe = await validateWorktreePath({
    repoPath: execution.repositoryPath,
    targetPath: execution.worktreePath,
    mutation: 'remove',
  });
  if (!safe.success) {
    return { status: 'failed', message: safe.error.message };
  }

  const branch = execution.deleteBranch
    ? ((await currentBranch(execution.worktreePath)) ?? execution.branchHint)
    : null;

  if (await pathExists(execution.worktreePath)) {
    try {
      await exec.exec(['worktree', 'remove', '--force', execution.worktreePath]);
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  // Clears leftover admin data for worktrees whose directory vanished out-of-band.
  await exec.exec(['worktree', 'prune']).catch(() => undefined);

  if (branch) {
    try {
      await exec.exec(['branch', '-D', branch]);
    } catch (error) {
      // A branch that is already gone satisfies the request.
      if (!/not found/iu.test(error instanceof Error ? error.message : String(error))) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return { status: 'succeeded' };
}

async function currentBranch(worktreePath: string): Promise<string | null> {
  try {
    const result = await createRegistryGitExec(worktreePath).exec(['branch', '--show-current']);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

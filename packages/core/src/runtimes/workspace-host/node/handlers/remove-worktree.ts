import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  removeWorktreeOperation,
  type WorkspaceHostError,
  type WorkspaceHostOperationResult,
} from '../../api';
import {
  killSessionsUnderPath,
  type WorkspaceHostSessionClients,
} from '../session/session-cleanup';
import {
  defaultGitExecFactory,
  deleteBranchIfExists,
  isMissingGitError,
  listWorktreePaths,
  type GitExecFactory,
} from './git-helpers';

export interface RemoveWorktreeHandlerDeps {
  sessions: WorkspaceHostSessionClients;
  createGitExec?: GitExecFactory;
}

export function createRemoveWorktreeHandler(deps: RemoveWorktreeHandlerDeps) {
  const createExec = deps.createGitExec ?? defaultGitExecFactory;
  return createOperationHandler(removeWorktreeOperation, async (ctx) => {
    const repoPath = formatAbsolute(ctx.input.repoPath);
    const worktreePath = formatAbsolute(ctx.input.worktreePath);
    const exec = createExec(repoPath);
    let changed = false;

    await ctx.stage('kill-sessions', 'Kill sessions under worktree', async () => {
      const result = await killSessionsUnderPath(deps.sessions, ctx.input.worktreePath);
      if (!result.success) ctx.reject(result.error);
    });

    await ctx.stage('remove-worktree', 'Remove git worktree', async () => {
      const paths = await listWorktreePaths(exec);
      if (!paths.has(worktreePath)) return;
      try {
        await exec.exec(['worktree', 'remove', '--force', worktreePath], { signal: ctx.signal });
        changed = true;
      } catch (error) {
        if (!isMissingGitError(error)) throw error;
      }
      await exec.exec(['worktree', 'prune'], { signal: ctx.signal });
    });

    if (ctx.input.deleteBranch && ctx.input.branchName) {
      const branchName = ctx.input.branchName;
      await ctx.stage('delete-branch', 'Delete git branch', async () => {
        changed = (await deleteBranchIfExists(exec, branchName)) || changed;
      });
    }

    return result(ctx.input.operationId, changed);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

export function operationError(message: string): WorkspaceHostError {
  return { type: 'operation-rejected', message };
}

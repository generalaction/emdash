import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  removeWorktreeOperation,
  removeWorktreeStagePlan,
  type WorkspaceHostError,
  type WorkspaceHostOperationResult,
} from '../../api';
import {
  killSessionsUnderPath,
  type WorkspaceHostSessionClients,
} from '../session/session-cleanup';
import { executeStagePlan, stageTarget } from './execute-stage-plan';
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

    await executeStagePlan(
      ctx,
      removeWorktreeStagePlan,
      {
        workspacePath: worktreePath,
        deleteBranch: ctx.input.deleteBranch ?? false,
        branchName: ctx.input.branchName,
      },
      {
        'kill-sessions': async () => {
          const result = await killSessionsUnderPath(deps.sessions, ctx.input.worktreePath);
          if (!result.success) ctx.reject(result.error);
        },
        'remove-worktree': async (stage) => {
          const target = stageTarget(stage);
          const paths = await listWorktreePaths(exec);
          if (!paths.has(target)) return;
          try {
            await exec.exec(['worktree', 'remove', '--force', target], { signal: ctx.signal });
            changed = true;
          } catch (error) {
            if (!isMissingGitError(error)) throw error;
          }
          await exec.exec(['worktree', 'prune'], { signal: ctx.signal });
        },
        'delete-branch': async () => {
          const branchName = ctx.input.branchName;
          if (!branchName) throw new Error('Delete-branch stage has no branch name');
          changed = (await deleteBranchIfExists(exec, branchName)) || changed;
        },
      }
    );

    return result(ctx.input.operationId, changed);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

export function operationError(message: string): WorkspaceHostError {
  return { type: 'operation-rejected', message };
}

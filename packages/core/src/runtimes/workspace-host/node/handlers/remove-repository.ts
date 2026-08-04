import { rm } from 'node:fs/promises';
import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  removeRepositoryOperation,
  removeRepositoryStagePlan,
  type WorkspaceHostOperationResult,
} from '../../api';
import {
  killSessionsUnderPath,
  type WorkspaceHostSessionClients,
} from '../session/session-cleanup';
import { executeStagePlan, stageTarget } from './execute-stage-plan';
import {
  defaultGitExecFactory,
  isMissingGitError,
  listWorktreePaths,
  type GitExecFactory,
} from './git-helpers';

export interface RemoveRepositoryHandlerDeps {
  sessions: WorkspaceHostSessionClients;
  createGitExec?: GitExecFactory;
}

export function createRemoveRepositoryHandler(deps: RemoveRepositoryHandlerDeps) {
  const createExec = deps.createGitExec ?? defaultGitExecFactory;
  return createOperationHandler(removeRepositoryOperation, async (ctx) => {
    const repoPath = formatAbsolute(ctx.input.repoPath);
    const exec = createExec(repoPath);
    let changed = false;

    const planContext = {
      repoPath,
      worktreePaths: [] as string[],
      repositoryMissing: false,
    };
    await executeStagePlan(ctx, removeRepositoryStagePlan, planContext, {
      'kill-sessions': async () => {
        const result = await killSessionsUnderPath(deps.sessions, ctx.input.repoPath);
        if (!result.success) ctx.reject(result.error);
      },
      'inspect-worktrees': async () => {
        try {
          planContext.worktreePaths = [...(await listWorktreePaths(exec))];
        } catch (error) {
          if (!isMissingGitError(error)) throw error;
          planContext.repositoryMissing = true;
        }
      },
      'remove-worktree': async (stage) => {
        const worktreePath = stageTarget(stage);
        try {
          await exec.exec(['worktree', 'remove', '--force', worktreePath], { signal: ctx.signal });
          changed = true;
        } catch (error) {
          if (!isMissingGitError(error)) throw error;
        }
      },
      'prune-worktrees': async () => {
        await exec.exec(['worktree', 'prune'], { signal: ctx.signal });
      },
      'remove-repository': async () => {
        await rm(repoPath, { recursive: true, force: true });
        changed = true;
      },
    });

    return result(ctx.input.operationId, changed);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

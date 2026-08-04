import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  createWorktreeOperation,
  createWorktreeStagePlan,
  type WorkspaceHostOperationResult,
  type WorkspaceHostError,
} from '../../api';
import type { WorkspaceHostSessionClients } from '../session/session-cleanup';
import { validateWorktreePath } from '../worktree-path-safety';
import { executeStagePlan } from './execute-stage-plan';
import {
  branchExists,
  defaultGitExecFactory,
  type GitExecFactory,
  listWorktreePaths,
} from './git-helpers';

export interface CreateWorktreeHandlerDeps {
  sessions: WorkspaceHostSessionClients;
  createGitExec?: GitExecFactory;
}

export function createCreateWorktreeHandler(deps: CreateWorktreeHandlerDeps) {
  const createExec = deps.createGitExec ?? defaultGitExecFactory;
  return createOperationHandler(createWorktreeOperation, async (ctx) => {
    const repoPath = formatAbsolute(ctx.input.repoPath);
    const worktreePath = formatAbsolute(ctx.input.worktreePath);
    const exec = createExec(repoPath);
    const safe = await validateWorktreePath({
      repoPath,
      targetPath: worktreePath,
      mutation: 'create',
      signal: ctx.signal,
      createGitExec: createExec,
    });
    if (!safe.success) ctx.reject(safe.error);

    const planContext = {
      workspacePath: worktreePath,
      fetch: ctx.input.fetch ?? false,
      existing: false,
    };
    await executeStagePlan(ctx, createWorktreeStagePlan, planContext, {
      inspect: async () => {
        const paths = await listWorktreePaths(exec);
        planContext.existing = paths.has(worktreePath);
      },
      fetch: async () => {
        await exec.exec(['fetch', '--all', '--prune'], { signal: ctx.signal });
      },
      'add-worktree': async () => {
        const exists = await branchExists(exec, ctx.input.branchName);
        const args = exists
          ? ['worktree', 'add', worktreePath, ctx.input.branchName]
          : [
              'worktree',
              'add',
              '-b',
              ctx.input.branchName,
              worktreePath,
              ctx.input.startPoint ?? 'HEAD',
            ];
        await exec.exec(args, { signal: ctx.signal });
      },
      verify: async () => {
        const paths = await listWorktreePaths(exec);
        if (!paths.has(worktreePath)) {
          ctx.reject(error(`Worktree was not listed after creation: ${worktreePath}`));
        }
      },
    });

    return result(ctx.input.operationId, !planContext.existing);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

function error(message: string): WorkspaceHostError {
  return { type: 'operation-rejected', message };
}

import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  createWorktreeOperation,
  type WorkspaceHostOperationResult,
  type WorkspaceHostError,
} from '../../api';
import type { WorkspaceHostSessionClients } from '../session/session-cleanup';
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

    const existing = await ctx.stage('inspect', 'Inspect worktrees', async () => {
      const paths = await listWorktreePaths(exec);
      return paths.has(worktreePath);
    });
    if (existing) {
      return result(ctx.input.operationId, false);
    }

    if (ctx.input.fetch) {
      await ctx.stage('fetch', 'Fetch repository refs', async () => {
        await exec.exec(['fetch', '--all', '--prune'], { signal: ctx.signal });
      });
    }

    await ctx.stage('add-worktree', 'Create git worktree', async () => {
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
    });

    await ctx.stage('verify', 'Verify worktree exists', async () => {
      const paths = await listWorktreePaths(exec);
      if (!paths.has(worktreePath)) {
        ctx.reject(error(`Worktree was not listed after creation: ${worktreePath}`));
      }
    });

    return result(ctx.input.operationId, true);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

function error(message: string): WorkspaceHostError {
  return { type: 'operation-rejected', message };
}

import { rm } from 'node:fs/promises';
import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import { removeRepositoryOperation, type WorkspaceHostOperationResult } from '../../api';
import {
  killSessionsUnderPath,
  type WorkspaceHostSessionClients,
} from '../session/session-cleanup';
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

    await ctx.stage('kill-sessions', 'Kill sessions under repository', async () => {
      const result = await killSessionsUnderPath(deps.sessions, ctx.input.repoPath);
      if (!result.success) ctx.reject(result.error);
    });

    await ctx.stage('remove-worktrees', 'Remove repository worktrees', async () => {
      let paths: Set<string>;
      try {
        paths = await listWorktreePaths(exec);
      } catch (error) {
        if (isMissingGitError(error)) return;
        throw error;
      }
      for (const worktreePath of paths) {
        if (worktreePath === repoPath) continue;
        try {
          await exec.exec(['worktree', 'remove', '--force', worktreePath], { signal: ctx.signal });
          changed = true;
        } catch (error) {
          if (!isMissingGitError(error)) throw error;
        }
      }
      await exec.exec(['worktree', 'prune'], { signal: ctx.signal });
    });

    await ctx.stage('remove-repository', 'Remove repository directory', async () => {
      await rm(repoPath, { recursive: true, force: true });
      changed = true;
    });

    return result(ctx.input.operationId, changed);
  });
}

function result(operationId: string, changed: boolean): WorkspaceHostOperationResult {
  return { operationId, changed };
}

import { createOperationHandler } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import {
  removeWorktreeOperation,
  removeWorktreeStagePlan,
  type WorkspaceHostError,
  type WorkspaceHostOperationResult,
} from '../../api';
import { WorkspaceInitManager } from '../session-init/workspace-init-manager';
import {
  killSessionsUnderPath,
  type WorkspaceHostSessionClients,
} from '../session/session-cleanup';
import { validateWorktreePath } from '../worktree-path-safety';
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
  initManager?: Pick<
    WorkspaceInitManager,
    'getConfiguredScript' | 'shutdown' | 'shutdownAndRunCapturedScript' | 'reportFailure'
  >;
}

export function createRemoveWorktreeHandler(deps: RemoveWorktreeHandlerDeps) {
  const createExec = deps.createGitExec ?? defaultGitExecFactory;
  const initManager = deps.initManager ?? new WorkspaceInitManager();
  return createOperationHandler(removeWorktreeOperation, async (ctx) => {
    const repoPath = formatAbsolute(ctx.input.repoPath);
    const worktreePath = formatAbsolute(ctx.input.worktreePath);
    const exec = createExec(repoPath);
    const safe = await validateWorktreePath({
      repoPath,
      targetPath: worktreePath,
      mutation: 'remove',
      signal: ctx.signal,
      createGitExec: createExec,
    });
    if (!safe.success) ctx.reject(safe.error);
    const registeredWorktrees = await listWorktreePaths(exec);
    if (!registeredWorktrees.has(worktreePath)) {
      return result(ctx.input.operationId, false);
    }
    let teardownScript: string | undefined;
    let teardownConfigError: unknown;
    try {
      teardownScript = await initManager.getConfiguredScript(worktreePath, 'teardown');
    } catch (error) {
      teardownConfigError = error;
    }
    if (teardownConfigError) {
      await ctx.stage('teardown-config', 'Read teardown configuration', async (stageContext) => {
        initManager.reportFailure(worktreePath, 'teardown', teardownConfigError);
        stageContext.fail(teardownConfigError);
      });
    }
    let changed = false;

    await executeStagePlan(
      ctx,
      removeWorktreeStagePlan,
      {
        workspacePath: worktreePath,
        deleteBranch: ctx.input.deleteBranch ?? false,
        branchName: ctx.input.branchName,
        teardownScript,
      },
      {
        'kill-sessions': async () => {
          const result = await killSessionsUnderPath(deps.sessions, ctx.input.worktreePath);
          if (!result.success) ctx.reject(result.error);
          if (!teardownScript) await initManager.shutdown(worktreePath);
        },
        teardown: async (_stage, stageContext) => {
          const outcome = await initManager.shutdownAndRunCapturedScript(
            worktreePath,
            'teardown',
            teardownScript!,
            ctx.signal
          );
          if (
            outcome.status === 'failed' ||
            outcome.status === 'timed-out' ||
            outcome.status === 'cancelled'
          ) {
            stageContext.fail(outcome.message);
          }
        },
        'remove-worktree': async (stage) => {
          const target = stageTarget(stage);
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

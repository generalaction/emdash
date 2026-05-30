import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import { provisionBYOITask } from '@main/core/workspaces/byoi/provision-byoi-task';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import type { Conversation } from '@shared/conversations';
import { taskProvisionProgressChannel, type ProvisionStep } from '@shared/events/taskEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { WorkspaceType as SharedWorkspaceType } from '@shared/workspaces';
import type { ProjectProvider, ProvisionResult, TaskProvider } from '../projects/project-provider';
import { withTimeout } from '../projects/utils';
import { loadConversationsForInitialHydration } from './load-initial-conversations';
import {
  formatProvisionTaskError,
  TASK_TIMEOUT_MS,
  toProvisionError,
  toTeardownError,
  type ProvisionTaskError,
  type TeardownTaskError,
} from './provision-task-error';
import { buildInstanceResources } from './instance-workspace-builder';
import { provisionLocalTask } from './task-builder';

export type WorkspaceHint = {
  id: string;
  type: SharedWorkspaceType;
  path?: string;
  repoInstanceId?: string;
};

type StoredTask = ProvisionResult & { projectId: string; ctx: IExecutionContext };

export type TaskManagerHooks = {
  'task:provisioned': (info: {
    projectId: string;
    taskId: string;
    taskBranch: string | undefined;
    workspaceId: string;
    worktreeGitDir?: string;
  }) => void | Promise<void>;
  'task:torn-down': (info: {
    projectId: string;
    taskId: string;
    workspaceId: string;
  }) => void | Promise<void>;
};

async function executeProvision(
  provider: ProjectProvider,
  task: Task,
  hint: WorkspaceHint,
  conversationsToHydrate: Conversation[]
): Promise<ProvisionResult> {
  const workspaceId = hint.id;

  const isByoi = hint.type === 'byoi';
  if (isByoi) {
    const projectSettings = await provider.settings.get();
    if (projectSettings.workspaceProvider?.type !== 'script') {
      throw new Error(
        'Task has workspaceProvider=byoi but project has no script provider configured'
      );
    }
    return provisionBYOITask({
      task,
      wpConfig: projectSettings.workspaceProvider,
      ctx: provider.ctx,
      projectId: provider.projectId,
      projectPath: provider.repoPath,
      settings: provider.settings,
      logPrefix: `${provider.type}ProjectProvider[byoi]`,
      workspaceId,
      conversationsToHydrate,
    });
  }

  // When a secondary repo instance was selected at task-creation time, build its
  // specific resources (execution context, WorktreeService, pool path) to override
  // the project's primary transport for this provision.
  const instanceResources = hint.repoInstanceId
    ? await buildInstanceResources(hint.repoInstanceId)
    : null;

  const effectiveType = instanceResources?.type ?? provider.defaultWorkspaceType;
  const effectiveProjectPath = instanceResources?.projectPath ?? provider.repoPath;
  const effectiveWorktreeService = instanceResources?.worktreeService ?? provider.worktreeService;

  const { provisionResult, workspace } = await provisionLocalTask({
    task,
    workspaceId,
    type: effectiveType,
    projectId: provider.projectId,
    projectPath: effectiveProjectPath,
    settings: provider.settings,
    worktreeService: effectiveWorktreeService,
    fetchService: provider.gitFetchService,
    repository: provider.repository,
    logPrefix: `${provider.type}ProjectProvider`,
    workDir: hint.path,
    conversationsToHydrate,
  });

  if (effectiveType.kind === 'local') {
    const mainDotGitAbs = path.resolve(effectiveProjectPath, '.git');
    const worktreeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
    return {
      ...provisionResult,
      persistData: { ...provisionResult.persistData, worktreeGitDir },
    };
  }

  const effectiveConnectionId =
    instanceResources?.connectionId ??
    (provider.defaultWorkspaceType.kind === 'ssh'
      ? provider.defaultWorkspaceType.connectionId
      : undefined);

  return {
    ...provisionResult,
    persistData: {
      ...provisionResult.persistData,
      sshConnectionId: effectiveConnectionId,
    },
  };
}

async function executeTeardown(
  task: TaskProvider,
  workspaceId: string,
  mode: TeardownMode
): Promise<void> {
  if (mode === 'detach') {
    await task.conversations.detachAll();
    await task.terminals.detachAll();
  } else {
    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
  }
  await workspaceRegistry.release(workspaceId, mode);
}

async function cleanupDetachedSessions(
  projectId: string,
  taskId: string,
  ctx: IExecutionContext
): Promise<void> {
  const { conversationIds, terminalIds } = await getTaskSessionLeafIds(projectId, taskId);
  const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
    makePtySessionId(projectId, taskId, leafId)
  );
  await Promise.all(
    sessionIds.map((sessionId) => killTmuxSession(ctx, makeTmuxSessionName(sessionId)))
  );
}

class TaskManager {
  private readonly _hooks = new HookCore<TaskManagerHooks>((name, e) =>
    log.error(`TaskManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleMap<StoredTask, ProvisionTaskError>({
    postTeardown: (taskId, stored) => {
      this._tasksByProject.get(stored.projectId)?.delete(taskId);
      this._hooks.callHookBackground('task:torn-down', {
        projectId: stored.projectId,
        taskId,
        workspaceId: stored.persistData.workspaceId,
      });
    },
  });
  private readonly _tasksByProject = new Map<string, Set<string>>();

  readonly hooks: Hookable<TaskManagerHooks> = this._hooks;

  async provisionTask(
    provider: ProjectProvider,
    task: Task,
    hint: WorkspaceHint
  ): Promise<Result<ProvisionResult, ProvisionTaskError>> {
    return this._lifecycle.provision(task.id, async () => {
      let lastStep: ProvisionStep | null = null;
      const unsubscribe = events.on(taskProvisionProgressChannel, (progress) => {
        if (progress.taskId === task.id) lastStep = progress.step;
      });
      try {
        const conversationsToHydrate = await loadConversationsForInitialHydration(
          provider.projectId,
          task.id
        );
        const result = await withTimeout(
          executeProvision(provider, task, hint, conversationsToHydrate),
          TASK_TIMEOUT_MS
        );
        const stored: StoredTask = {
          ...result,
          projectId: provider.projectId,
          ctx: provider.ctx,
        };

        const byProject = this._tasksByProject.get(provider.projectId) ?? new Set<string>();
        byProject.add(task.id);
        this._tasksByProject.set(provider.projectId, byProject);

        this._hooks.callHookBackground('task:provisioned', {
          projectId: provider.projectId,
          taskId: task.id,
          taskBranch: task.taskBranch,
          workspaceId: result.persistData.workspaceId,
          worktreeGitDir: result.persistData.worktreeGitDir,
        });

        return ok(stored);
      } catch (e) {
        const provisionError = toProvisionError(e, lastStep);
        log.error('TaskManager: failed to provision task', {
          taskId: task.id,
          projectId: provider.projectId,
          error: String(e),
        });
        return err(provisionError);
      } finally {
        unsubscribe();
      }
    });
  }

  async teardownTask(
    taskId: string,
    mode: TeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    const result = this._lifecycle.teardown(
      taskId,
      async ({ taskProvider, persistData, projectId, ctx }) => {
        try {
          await withTimeout(
            executeTeardown(taskProvider, persistData.workspaceId, mode),
            TASK_TIMEOUT_MS
          );
          return ok();
        } catch (e) {
          log.error('TaskManager: failed to teardown task', { taskId, error: String(e) });
          await cleanupDetachedSessions(projectId, taskId, ctx).catch((cleanupError) => {
            log.warn('TaskManager: fallback cleanup failed', {
              taskId,
              error: String(cleanupError),
            });
          });
          return err<TeardownTaskError>(toTeardownError(e));
        }
      }
    );

    return result ?? ok();
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode): Promise<void> {
    const taskIds = Array.from(this._tasksByProject.get(projectId) ?? []);
    if (mode === 'detach') {
      // Detach sessions but leave workspaces alive; provider.cleanup() will call
      // workspaceRegistry.releaseAllForProject to handle workspace teardown.
      await Promise.all(
        taskIds.flatMap((id) => {
          const stored = this._lifecycle.get(id);
          if (!stored) return [];
          return [
            stored.taskProvider.conversations.detachAll(),
            stored.taskProvider.terminals.detachAll(),
          ];
        })
      );
      // Remove entries from lifecycle maps without running workspace teardown.
      this._tasksByProject.delete(projectId);
      await Promise.all(
        taskIds.map((id) => this._lifecycle.teardown(id, async () => ok()) ?? Promise.resolve(ok()))
      );
    } else {
      // teardownTask handles _tasksByProject cleanup in onFinally.
      await Promise.all(taskIds.map((id) => this.teardownTask(id, 'terminate')));
    }
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this._lifecycle.get(taskId)?.taskProvider;
  }

  getWorkspaceId(taskId: string): string | undefined {
    return this._lifecycle.get(taskId)?.persistData.workspaceId;
  }

  getPersistData(taskId: string): ProvisionResult['persistData'] | undefined {
    return this._lifecycle.get(taskId)?.persistData;
  }

  getBootstrapStatus(taskId: string): TaskBootstrapStatus {
    return this._lifecycle.bootstrapStatus(taskId, formatProvisionTaskError);
  }
}

export const taskManager = new TaskManager();

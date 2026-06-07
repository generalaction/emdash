import type { IExecutionContext } from '@main/core/execution-context/types';
import { nativeChatService } from '@main/core/native-chat/native-chat-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import type { WorkspaceBootstrapResult } from '@main/core/workspaces/workspace-bootstrap-service';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { TaskBootstrapStatus } from '@shared/core/tasks/tasks';
import type { WorkspaceType as SharedWorkspaceType } from '@shared/core/workspaces/workspaces';
import { ok, type Result } from '@shared/lib/result';
import type {
  ProvisionResult,
  TaskProvider,
  WorkspaceProviderData,
} from '../projects/project-provider';
import { withTimeout } from '../projects/utils';
import {
  formatProvisionTaskError,
  formatTeardownTaskError,
  TASK_TIMEOUT_MS,
  toTeardownError,
  type ProvisionTaskError,
  type TeardownTaskError,
} from './provision-task-error';

export type WorkspaceHint = {
  id: string;
  type: SharedWorkspaceType;
  path?: string;
};

type StoredTask = ProvisionResult & { projectId: string; ctx: IExecutionContext };

export type TaskManagerHooks = {
  'task:provisioned': (info: {
    projectId: string;
    taskId: string;
    branchName: string | undefined;
    workspaceId: string;
    worktreeGitDir?: string;
  }) => void | Promise<void>;
  'task:torn-down': (info: {
    projectId: string;
    taskId: string;
    workspaceId: string;
  }) => void | Promise<void>;
};

async function executeTeardown(
  projectId: string,
  taskId: string,
  task: TaskProvider,
  workspaceId: string,
  mode: TeardownMode
): Promise<void> {
  await nativeChatService.disposeTask(projectId, taskId);
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

class TaskSessionManager {
  private readonly _hooks = new HookCore<TaskManagerHooks>((name, e) =>
    log.error(`TaskManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleMap<StoredTask, ProvisionTaskError, TeardownTaskError>(
    {
      postTeardown: (taskId, stored) => {
        this._tasksByProject.get(stored.projectId)?.delete(taskId);
        this._hooks.callHookBackground('task:torn-down', {
          projectId: stored.projectId,
          taskId,
          workspaceId: stored.persistData.workspaceId,
        });
      },
    }
  );
  private readonly _tasksByProject = new Map<string, Set<string>>();

  readonly hooks: Hookable<TaskManagerHooks> = this._hooks;

  /**
   * Registers a fully-provisioned task into the lifecycle map.
   * Idempotent — if the task is already registered, returns immediately.
   * Fires `task:provisioned` hook for telemetry, git watchers, PR sync.
   */
  async registerTask(
    taskId: string,
    result: WorkspaceBootstrapResult,
    projectId: string,
    ctx: IExecutionContext
  ): Promise<void> {
    const stored: StoredTask = {
      taskProvider: result.taskProvider,
      persistData: {
        workspaceId: result.workspaceId,
        sshConnectionId: result.sshConnectionId,
        worktreeGitDir: result.worktreeGitDir,
        workspaceProviderData: result.workspaceProviderData as WorkspaceProviderData | undefined,
      },
      projectId,
      ctx,
    };

    // Use provision() for deduplication: if already active, returns existing immediately.
    await this._lifecycle.provision(taskId, async () => ok(stored));

    const byProject = this._tasksByProject.get(projectId) ?? new Set<string>();
    byProject.add(taskId);
    this._tasksByProject.set(projectId, byProject);

    this._hooks.callHookBackground('task:provisioned', {
      projectId,
      taskId,
      branchName: result.taskProvider.taskBranch,
      workspaceId: result.workspaceId,
      worktreeGitDir: result.worktreeGitDir,
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
            executeTeardown(projectId, taskId, taskProvider, persistData.workspaceId, mode),
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
          return { success: false as const, error: toTeardownError(e) };
        }
      }
    );

    return result ?? ok();
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode): Promise<void> {
    const taskIds = Array.from(this._tasksByProject.get(projectId) ?? []);
    if (mode === 'detach') {
      await Promise.all(taskIds.map((id) => nativeChatService.disposeTask(projectId, id)));
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
    const s = this._lifecycle.bootstrapStatus(taskId);
    if (s.status === 'error')
      return { status: 'error', message: formatProvisionTaskError(s.error) };
    return s;
  }

  getTeardownStatus(taskId: string): TaskBootstrapStatus {
    const s = this._lifecycle.teardownStatus(taskId);
    if (s.status === 'error') return { status: 'error', message: formatTeardownTaskError(s.error) };
    return s;
  }
}

export const taskSessionManager = new TaskSessionManager();

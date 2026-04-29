import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import type { ExecFn } from '@main/core/utils/exec';
import { provisionBYOITask } from '@main/core/workspaces/byoi/provision-byoi-task';
import { localWorkspaceId, sshWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import type { ProjectProvider, ProvisionResult, TaskProvider } from './project-provider';
import {
  formatProvisionTaskError,
  TASK_TIMEOUT_MS,
  toProvisionError,
  toTeardownError,
  type ProvisionTaskError,
  type TeardownTaskError,
} from './provision-task-error';
import { provisionLocalTask } from './task-builder';
import { withTimeout } from './utils';

type StoredTask = ProvisionResult & { projectId: string; exec: ExecFn };

export type TaskManagerHooks = {
  'task:provisioned': (info: {
    projectId: string;
    taskId: string;
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
  conversations: Conversation[],
  terminals: Terminal[]
): Promise<ProvisionResult> {
  if (task.workspaceProvider === 'byoi') {
    const projectSettings = await provider.settings.get();
    if (projectSettings.workspaceProvider?.type !== 'script') {
      throw new Error(
        'Task has workspaceProvider=byoi but project has no script provider configured'
      );
    }
    return provisionBYOITask({
      task,
      conversations,
      terminals,
      wpConfig: projectSettings.workspaceProvider,
      execFn: provider.exec,
      projectId: provider.projectId,
      projectPath: provider.repoPath,
      settings: provider.settings,
      logPrefix: `${provider.type}ProjectProvider[byoi]`,
    });
  }

  void provider.gitFetchService.fetch();
  void prSyncScheduler.onTaskProvisioned(provider.projectId, task.taskBranch);

  const workspaceId =
    provider.defaultWorkspaceType.kind === 'local'
      ? localWorkspaceId(provider.projectId, task.taskBranch)
      : sshWorkspaceId(provider.projectId, task.taskBranch);

  const { provisionResult, workspace } = await provisionLocalTask({
    task,
    conversations,
    terminals,
    workspaceId,
    type: provider.defaultWorkspaceType,
    projectId: provider.projectId,
    projectPath: provider.repoPath,
    settings: provider.settings,
    worktreeService: provider.worktreeService,
    fetchService: provider.gitFetchService,
    repository: provider.repository,
    logPrefix: `${provider.type}ProjectProvider`,
  });

  if (provider.defaultWorkspaceType.kind === 'local') {
    const mainDotGitAbs = path.resolve(provider.repoPath, '.git');
    const worktreeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
    return {
      ...provisionResult,
      persistData: { ...provisionResult.persistData, worktreeGitDir },
    };
  }

  return {
    ...provisionResult,
    persistData: {
      ...provisionResult.persistData,
      sshConnectionId: provider.defaultWorkspaceType.connectionId,
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
  exec: ExecFn
): Promise<void> {
  const { conversationIds, terminalIds } = await getTaskSessionLeafIds(projectId, taskId);
  const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
    makePtySessionId(projectId, taskId, leafId)
  );
  await Promise.all(
    sessionIds.map((sessionId) => killTmuxSession(exec, makeTmuxSessionName(sessionId)))
  );
}

class TaskManager {
  private readonly _lifecycle = new LifecycleMap<StoredTask, ProvisionTaskError>();
  private readonly _tasksByProject = new Map<string, Set<string>>();
  private readonly _hooks = new HookCore<TaskManagerHooks>((name, e) =>
    log.error(`TaskManager: ${String(name)} hook error`, e)
  );

  readonly hooks: Hookable<TaskManagerHooks> = this._hooks;

  async provisionTask(
    provider: ProjectProvider,
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<ProvisionResult, ProvisionTaskError>> {
    return this._lifecycle.provision(task.id, async () => {
      try {
        const result = await withTimeout(
          executeProvision(provider, task, conversations, terminals),
          TASK_TIMEOUT_MS
        );
        const stored: StoredTask = {
          ...result,
          projectId: provider.projectId,
          exec: provider.exec,
        };

        const byProject = this._tasksByProject.get(provider.projectId) ?? new Set<string>();
        byProject.add(task.id);
        this._tasksByProject.set(provider.projectId, byProject);

        this._hooks.callHookBackground('task:provisioned', {
          projectId: provider.projectId,
          taskId: task.id,
          workspaceId: result.persistData.workspaceId,
          worktreeGitDir: result.persistData.worktreeGitDir,
        });

        return ok(stored);
      } catch (e) {
        const provisionError = toProvisionError(e);
        log.error('TaskManager: failed to provision task', {
          taskId: task.id,
          projectId: provider.projectId,
          error: String(e),
        });
        return err(provisionError);
      }
    });
  }

  async teardownTask(
    taskId: string,
    mode: TeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    // Pre-capture stored task so the onFinally closure has access to hook data.
    const stored = this._lifecycle.get(taskId);

    const result = this._lifecycle.teardown(
      taskId,
      async ({ taskProvider, persistData, projectId, exec }) => {
        try {
          await withTimeout(
            executeTeardown(taskProvider, persistData.workspaceId, mode),
            TASK_TIMEOUT_MS
          );
          return ok();
        } catch (e) {
          log.error('TaskManager: failed to teardown task', { taskId, error: String(e) });
          await cleanupDetachedSessions(projectId, taskId, exec).catch((cleanupError) => {
            log.warn('TaskManager: fallback cleanup failed', {
              taskId,
              error: String(cleanupError),
            });
          });
          return err<TeardownTaskError>(toTeardownError(e));
        }
      },
      () => {
        if (!stored) return;
        this._tasksByProject.get(stored.projectId)?.delete(taskId);
        this._hooks.callHookBackground('task:torn-down', {
          projectId: stored.projectId,
          taskId,
          workspaceId: stored.persistData.workspaceId,
        });
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

  getBootstrapStatus(taskId: string): TaskBootstrapStatus {
    return this._lifecycle.bootstrapStatus(taskId, formatProvisionTaskError);
  }
}

export const taskManager = new TaskManager();

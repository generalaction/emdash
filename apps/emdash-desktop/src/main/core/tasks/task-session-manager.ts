import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { killTmuxSession, makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import { ok, type Result } from '@emdash/shared';
import {
  LifecycleRegistry,
  type LifecycleRegistryState,
  type LifecycleRegistryStateChange,
} from '@emdash/shared/concurrency';
import { runWithTimeout } from '@emdash/shared/scheduling';
import { createLiveJobReplica } from '@emdash/wire';
import { deactivateWorkspaceParticipants } from '@core/features/workspaces/node/lifecycle-participants';
import { workspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import type { TaskBootstrapStatus } from '@core/primitives/tasks/api';
import type { WorkspaceType as SharedWorkspaceType } from '@core/primitives/workspaces/api';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import type { WorkspaceBootstrapResult } from '@main/core/workspaces/workspace-bootstrap-service';
import { getDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type {
  ProvisionResult,
  TaskProvider,
  WorkspaceProviderData,
} from '../projects/project-provider';
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

type TeardownMode = 'detach' | 'terminate';

type StoredTask = ProvisionResult & { projectId: string; ctx: IExecutionContext };
type RuntimeStoredTask = StoredTask & {
  runtimeWorkspace?: HostFileRef;
  automation?: WorkspaceBootstrapResult['postActivationAutomation'];
};
type TaskStartInput = { taskId: string; stored: RuntimeStoredTask };
type TaskLifecycleState = LifecycleRegistryState<
  RuntimeStoredTask,
  ProvisionTaskError,
  TeardownTaskError
>;
type TaskLifecycleStateChange = LifecycleRegistryStateChange<
  RuntimeStoredTask,
  ProvisionTaskError,
  TeardownTaskError
>;

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

/**
 * Task-level teardown intent. Wider than {@link TeardownMode} because archive needs to
 * reap the running agent like `terminate` while keeping the workspace like `detach`:
 *
 * - `detach`: leave tmux sessions and agent processes running so the task can be
 *   remounted later (used on app/project shutdown when tmux is enabled).
 * - `terminate`: reap tmux sessions + agent processes and destroy the workspace
 *   (worktree removal, teardown script). Used by delete.
 * - `archive`: reap tmux sessions + agent processes like `terminate`, but keep the
 *   workspace/worktree (and the persisted `conversations.session_id`) so the task stays
 *   restorable. Without this, archiving a tmux-backed task leaked its session and agent
 *   process indefinitely (#2689).
 */
export type TaskTeardownMode = TeardownMode | 'archive';

export async function executeTeardown(
  task: TaskProvider,
  workspaceId: string,
  mode: TaskTeardownMode,
  runtimeWorkspace?: HostFileRef,
  automation?: WorkspaceBootstrapResult['postActivationAutomation']
): Promise<void> {
  if (mode === 'detach') {
    // Keep the tmux sessions and agent processes alive for a later remount.
    await task.conversations.detachAll();
  } else {
    // 'terminate' and 'archive' both reap the tmux sessions and agent processes.
    await task.conversations.destroyAll();
  }
  await deactivateWorkspaceConsumer(
    task.taskId,
    workspaceId,
    mode === 'detach' ? 'detach' : 'stop',
    mode === 'terminate',
    automation,
    runtimeWorkspace
  );
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

async function deactivateWorkspaceConsumer(
  taskId: string,
  workspaceId: string,
  strategy: 'stop' | 'detach',
  teardown: boolean,
  automation?: WorkspaceBootstrapResult['postActivationAutomation'],
  runtimeWorkspace?: HostFileRef
): Promise<void> {
  const identity = await workspaceIdentityService.resolve(workspaceId);
  const workspace =
    identity && hostFileRefFromNativePath(identity.path, sshConnectionIdOf(identity.host));
  const target = workspace ?? runtimeWorkspace;
  if (!target) return;
  const brokerLease = getDesktopRuntimeBroker().session(target.host);
  try {
    const runtime = await brokerLease.ready();
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    await runWorkspaceDeactivateJob(runtime.data.workspace.deactivate, {
      workspace: target,
      consumerId: taskId,
      strategy,
      automation: strategy === 'stop' ? automation : undefined,
    });
    const snapshot = await runtime.data.workspace.workspace
      .state(target, 'state')
      .asLiveSource()
      .snapshot();
    const hasConsumers =
      ((snapshot.data as { consumers?: readonly unknown[] }).consumers?.length ?? 0) > 0;
    if (hasConsumers) return;
    if (identity) await deactivateWorkspaceParticipants(identity);
    if (teardown) {
      await runWorkspaceTeardownJob(runtime.data.workspace.teardown, {
        workspace: target,
        force: false,
        automation,
      });
    }
  } finally {
    await brokerLease.release();
  }
}

async function runWorkspaceDeactivateJob(
  handle: Parameters<typeof createLiveJobReplica<typeof workspaceContract.deactivate>>[1],
  input: Parameters<
    ReturnType<typeof createLiveJobReplica<typeof workspaceContract.deactivate>>['start']
  >[0]
): Promise<void> {
  const jobs = createLiveJobReplica(workspaceContract.deactivate, handle);
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    await job.result;
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

async function runWorkspaceTeardownJob(
  handle: Parameters<typeof createLiveJobReplica<typeof workspaceContract.teardown>>[1],
  input: Parameters<
    ReturnType<typeof createLiveJobReplica<typeof workspaceContract.teardown>>['start']
  >[0]
): Promise<void> {
  const jobs = createLiveJobReplica(workspaceContract.teardown, handle);
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    await job.result;
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

class TaskSessionManager {
  private readonly _hooks = new HookCore<TaskManagerHooks>((name, e) =>
    log.error(`TaskManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleRegistry<
    TaskStartInput,
    StoredTask,
    ProvisionTaskError,
    TaskTeardownMode,
    TeardownTaskError
  >({
    label: 'task-session-manager',
    keyOf: (input) => input.taskId,
    start: async (input) => ok(input.stored),
    stop: async (taskId, stored, mode) => this.stopTask(taskId, stored, mode ?? 'terminate'),
    onStateChanged: (change) => this.handleLifecycleStateChanged(change),
    onObserverError: ({ error }) => log.error('TaskManager: lifecycle observer error', error),
  });
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
    const stored: RuntimeStoredTask = {
      taskProvider: result.taskProvider,
      runtimeWorkspace: result.runtimeWorkspace,
      automation: result.postActivationAutomation,
      persistData: {
        workspaceId: result.workspaceId,
        sshConnectionId: result.sshConnectionId,
        worktreeGitDir: result.worktreeGitDir,
        workspaceProviderData: result.workspaceProviderData as WorkspaceProviderData | undefined,
      },
      projectId,
      ctx,
    };

    await this._lifecycle.register(taskId, stored);

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
    mode: TaskTeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return this._lifecycle.stop(taskId, mode);
  }

  async forceRemoveTask(taskId: string, reason?: unknown): Promise<void> {
    await this._lifecycle.forceRemove(taskId, reason);
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode): Promise<void> {
    const taskIds = Array.from(this._tasksByProject.get(projectId) ?? []);
    await Promise.all(taskIds.map((id) => this.teardownTask(id, mode)));
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
    const state = this._lifecycle.state(taskId);
    switch (state.kind) {
      case 'ready':
      case 'stopping':
      case 'stop-failed':
        return { status: 'ready' };
      case 'starting':
        return { status: 'bootstrapping' };
      case 'start-failed':
        return { status: 'error', message: formatProvisionTaskError(state.error) };
      case 'idle':
      case 'disposed':
        return { status: 'not-started' };
    }
  }

  getTeardownStatus(taskId: string): TaskBootstrapStatus {
    const state = this._lifecycle.state(taskId);
    switch (state.kind) {
      case 'stopping':
        return { status: 'bootstrapping' };
      case 'stop-failed':
        return { status: 'error', message: formatTeardownTaskError(state.error) };
      case 'idle':
      case 'starting':
      case 'ready':
      case 'start-failed':
      case 'disposed':
        return { status: 'not-started' };
    }
  }

  private async stopTask(
    taskId: string,
    { taskProvider, persistData, projectId, ctx, runtimeWorkspace, automation }: RuntimeStoredTask,
    mode: TaskTeardownMode
  ): Promise<Result<void, TeardownTaskError>> {
    try {
      await runWithTimeout(
        () =>
          executeTeardown(
            taskProvider,
            persistData.workspaceId,
            mode,
            runtimeWorkspace,
            automation
          ),
        {
          timeoutMs: TASK_TIMEOUT_MS,
        }
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

  private handleLifecycleStateChanged(change: TaskLifecycleStateChange): void {
    const stored = taskFromState(change.previous);
    if (!stored || !isRemovedState(change.current)) return;

    const byProject = this._tasksByProject.get(stored.projectId);
    byProject?.delete(change.key);
    if (byProject?.size === 0) this._tasksByProject.delete(stored.projectId);

    this._hooks.callHookBackground('task:torn-down', {
      projectId: stored.projectId,
      taskId: change.key,
      workspaceId: stored.persistData.workspaceId,
    });
  }
}

export const taskSessionManager = new TaskSessionManager();

function taskFromState(state: TaskLifecycleState): StoredTask | undefined {
  switch (state.kind) {
    case 'ready':
    case 'stopping':
    case 'stop-failed':
      return state.value;
    case 'idle':
    case 'starting':
    case 'start-failed':
    case 'disposed':
      return undefined;
  }
}

function isRemovedState(state: TaskLifecycleState): boolean {
  return state.kind === 'idle' || state.kind === 'disposed';
}

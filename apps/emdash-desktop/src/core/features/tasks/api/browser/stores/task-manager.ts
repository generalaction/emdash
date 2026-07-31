import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import { err, isDeepEqual, ok, type Result as SharedResult } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createLiveJobReplica, createLiveModelReplica, type LiveModelReplica } from '@emdash/wire';
import { optimistic, remote, type OptimisticView, type RemoteModel } from '@emdash/wire/state';
import { makeObservable, observable, runInAction, toJS } from 'mobx';
import { toast } from 'sonner';
import { match } from 'ts-pattern';
import type { ProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-settings-store';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { tasksWireContract } from '@core/features/tasks/api';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  type TaskStore,
  type TaskStoreMutations,
} from '@core/features/tasks/api/browser/stores/task-store';
import {
  formatFetchErrorDetail,
  formatPushErrorDetail,
} from '@core/features/tasks/api/browser/utils';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import {
  workspacesWireContract,
  type WorkspaceBootstrapState,
} from '@core/features/workspaces/api';
import { getWorkspacesWireClient } from '@core/features/workspaces/api/browser/client';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { ScopedStoreLookup } from '@core/primitives/scoped-stores/browser';
import {
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
} from '@core/primitives/task-state/browser/task-state';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskWarning,
  DeleteTaskOptions,
  RenameTaskError,
  RenameTaskSuccess,
  Task,
  TaskLifecycleStatus,
  TaskListData,
  TaskRow,
  TaskStatsData,
} from '@core/primitives/tasks/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { reconcileKeyedEntities } from '@renderer/lib/state/keyed-entity-reconciler';
import { observeReadableInAction } from '@renderer/lib/state/mobx-readable';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';

type TaskMutationInvocation<Data, Error> = {
  result: SharedResult<{ data: Data; cursors: unknown[] }, Error>;
  settled: Promise<void>;
};

type TaskListRemoteMember = ReturnType<RemoteModel<typeof tasksWireContract.taskList>>;

function formatCreateTaskError(error: CreateTaskError, opts?: { isSshProject?: boolean }): string {
  return match(error)
    .with({ type: 'project-not-found' }, () => 'Project not found.')
    .with(
      { type: 'initial-commit-required' },
      () => 'Create an initial commit to enable branch-based tasks.'
    )
    .with({ type: 'branch-create-failed' }, (e) => {
      switch (e.error.type) {
        case 'already_exists':
          return `Branch "${e.error.branch}" already exists. Try a different task name.`;
        case 'fetch_failed':
          return `Could not update "${e.error.remote}/${e.error.branch}" before creating the task: ${formatFetchErrorDetail(e.error.error, opts)}`;
        case 'invalid_base':
          return `Source branch "${e.error.from}" is not a valid base. Check that it exists locally or on the selected remote.`;
        case 'invalid_name':
          return `Branch "${e.error.branch}" is not a valid branch name.`;
        default:
          return `Could not create branch "${e.branch}": ${e.error.message}`;
      }
    })
    .with({ type: 'pr-fetch-failed' }, (e) =>
      e.error.type === 'not_found'
        ? `PR #${e.error.prNumber} was not found on remote "${e.remote}".`
        : `Could not fetch the pull request branch: ${e.error.message}`
    )
    .with(
      { type: 'branch-not-found' },
      (e) =>
        `Branch "${e.branch}" was not found locally or on the remote. Make sure the PR branch exists.`
    )
    .with({ type: 'worktree-setup-failed' }, (e) =>
      e.message
        ? `Could not set up the worktree for branch "${e.branch}": ${e.message}`
        : `Could not set up the worktree for branch "${e.branch}".`
    )
    .with({ type: 'provision-failed' }, (e) => e.message)
    .with({ type: 'provision-timeout' }, (e) => `Provisioning timed out after ${e.timeoutMs}ms.`)
    .exhaustive();
}

function formatProvisionWorkspaceError(error: WorkspaceError): string {
  return error.message || `Workspace provisioning failed (${error.type}).`;
}

function formatCreateTaskWarning(warning: CreateTaskWarning): string {
  return match(warning)
    .with({ type: 'branch-publish-failed' }, (w) => {
      const detail = formatPushErrorDetail(w.error);
      return `Failed to publish branch "${w.branch}" to "${w.remote}": ${detail}`;
    })
    .exhaustive();
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfMutationFailed(result: SharedResult<unknown, unknown>): void {
  if (!result.success) throw new Error(formatErrorMessage(result.error));
}

function wireErrorToWorkspaceError(error: unknown): WorkspaceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as WorkspaceError;
  }
  return {
    type: 'workspace-wire-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export class TaskManagerStore {
  private readonly projectId: string;
  private readonly _settingsStore: ProjectSettingsStore;
  private _loadPromise: Promise<void> | null = null;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();
  private readonly _taskListScope: Scope = createScope({ label: 'task-list-replica' });
  private _taskListRemote: RemoteModel<typeof tasksWireContract.taskList> | null = null;
  private _taskStatsRemote: RemoteModel<typeof tasksWireContract.taskStats> | null = null;
  private _taskListView: OptimisticView<TaskListData> | null = null;
  private _taskListData: TaskListData | null = null;
  private _taskStats: TaskStatsData = { byWorkspaceId: {} };
  private _taskListAttemptScope: Scope | null = null;
  private _bootstrapReplicaPromise: Promise<
    LiveModelReplica<typeof workspacesWireContract.bootstrap>
  > | null = null;
  private _bootstrapDisposers = new Map<string, () => void>();
  private readonly _taskMutations: TaskStoreMutations = {
    rename: (task, name) => this._renameTask(task, name),
    updateStatus: (task, status) => this._updateTaskStatus(task, status),
    setPinned: (task, isPinned) => this._setTaskPinned(task, isPinned),
    updateLinkedIssue: (task, issue) => this._updateLinkedIssue(task, issue),
    convertAutomationTask: (task) => this._convertAutomationTask(task),
  };

  tasks = observable.map<string, TaskStore>();

  constructor(
    projectId: string,
    settingsStore: ProjectSettingsStore,
    private readonly projectStores?: ScopedStoreLookup
  ) {
    this.projectId = projectId;
    this._settingsStore = settingsStore;
    makeObservable(this, { tasks: observable });
  }

  loadTasks(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._ensureTaskListModels().catch((e) => {
        log.error('Error loading tasks', { error: e });
        this._loadPromise = null;
      });
    }
    return this._loadPromise;
  }

  private async _ensureTaskListModels(): Promise<void> {
    if (this._taskListView) return;
    const attemptScope = this._taskListScope.child('task-list-models');
    const client = await getDesktopWireClient();
    const taskListRemote = remote(tasksWireContract.taskList, client.tasks.taskList, {
      scope: attemptScope,
      lingerMs: 15_000,
    });
    const taskStatsRemote = remote(tasksWireContract.taskStats, client.tasks.taskStats, {
      scope: attemptScope,
      lingerMs: 15_000,
    });
    this._taskListRemote = taskListRemote;
    this._taskStatsRemote = taskStatsRemote;
    const taskListMember = this._taskListRemote({ projectId: this.projectId });
    const taskStatsMember = this._taskStatsRemote({ projectId: this.projectId });
    const taskListView = optimistic(taskListMember.states.list);
    this._taskListView = taskListView;

    const ready = new Promise<void>((resolve, reject) => {
      let resolved = false;
      observeReadableInAction(
        taskListView,
        (current) => {
          if (current.status === 'error') {
            reject(current.error);
            return;
          }
          if (!current.value) return;
          this._taskListData = current.value;
          this._reconcileTaskRows(current.value.tasks);
          if (!resolved) {
            resolved = true;
            resolve();
          }
        },
        { scope: attemptScope }
      );
    });
    observeReadableInAction(
      taskStatsMember.states.stats,
      (current) => {
        if (!current.value) return;
        const previousStats = this._taskStats;
        this._taskStats = current.value;
        this._applyTaskStats(previousStats, current.value);
      },
      { scope: attemptScope }
    );
    try {
      await ready;
      this._taskListAttemptScope = attemptScope;
    } catch (error) {
      if (this._taskListRemote === taskListRemote) this._taskListRemote = null;
      if (this._taskStatsRemote === taskStatsRemote) this._taskStatsRemote = null;
      if (this._taskListView === taskListView) this._taskListView = null;
      this._taskListData = null;
      await taskListRemote.dispose();
      await taskStatsRemote.dispose();
      await attemptScope.dispose();
      throw error;
    }
  }

  private _reconcileTaskRows(rows: readonly TaskRow[]): void {
    reconcileKeyedEntities({
      rows,
      stores: this.tasks,
      getRowId: (row) => row.id,
      create: (row) => {
        const task = this._taskFromRow(row);
        return createUnprovisionedTask(task, this.projectStores, this._taskMutations);
      },
      update: (current, row) => {
        const task = this._taskFromRow(row);
        if (isUnregistered(current)) {
          current.transitionToUnprovisioned(task);
          if (task.workspaceId) this._watchWorkspaceBootstrap(task.id, task.workspaceId);
          return;
        }
        if (!isDeepEqual(current.data, task)) current.data = task;
        if (task.workspaceId) this._watchWorkspaceBootstrap(task.id, task.workspaceId);
      },
      shouldKeepMissing: (_taskId, task) => isUnregistered(task),
      onAppear: (_store, row) => {
        if (row.workspaceId) this._watchWorkspaceBootstrap(row.id, row.workspaceId);
      },
      remove: (task, taskId) => {
        this._bootstrapDisposers.get(taskId)?.();
        this._bootstrapDisposers.delete(taskId);
        task.dispose();
        appState.navigation.invalidateSubject(taskSubject({ taskId }));
      },
    });
  }

  private _taskFromRow(row: TaskRow): Task {
    const git = row.workspaceId ? this._taskStats.byWorkspaceId[row.workspaceId] : undefined;
    return {
      ...row,
      prs: [],
      workspaceGit: git,
    };
  }

  private _applyTaskStats(previous: TaskStatsData, next: TaskStatsData): void {
    const changedWorkspaceIds = new Set<string>();
    for (const workspaceId of new Set([
      ...Object.keys(previous.byWorkspaceId),
      ...Object.keys(next.byWorkspaceId),
    ])) {
      if (!isDeepEqual(previous.byWorkspaceId[workspaceId], next.byWorkspaceId[workspaceId])) {
        changedWorkspaceIds.add(workspaceId);
      }
    }
    if (changedWorkspaceIds.size === 0) return;

    runInAction(() => {
      for (const task of this.tasks.values()) {
        if (!isRegistered(task)) continue;
        const workspaceId = task.data.workspaceId;
        if (!workspaceId || !changedWorkspaceIds.has(workspaceId)) continue;
        const workspaceGit = next.byWorkspaceId[workspaceId];
        if (!isDeepEqual(task.data.workspaceGit, workspaceGit)) {
          task.data = { ...task.data, workspaceGit };
        }
      }
    });
  }

  async createTask(params: CreateTaskParams) {
    runInAction(() => {
      const { taskConfig } = params;
      this.tasks.set(
        params.id,
        createUnregisteredTask(
          {
            id: params.id,
            lastInteractedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            name: taskConfig.name,
            status: taskConfig.initialStatus ?? 'in_progress',
            statusChangedAt: new Date().toISOString(),
            isPinned: false,
            type: 'task',
          },
          this.projectId,
          this.projectStores,
          this._taskMutations
        )
      );
    });

    const result = await getDesktopWireClient()
      .then((client) =>
        client.tasks.createTask(JSON.parse(JSON.stringify(toJS(params))) as typeof params)
      )
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current && isUnregistered(current)) {
            current.phase = 'create-error';
            current.errorMessage = message;
          }
        });
        throw e;
      });

    if (!result.success) {
      const message = formatCreateTaskError(result.error, {
        isSshProject: appState.projects.projects.get(this.projectId)?.data?.type === 'ssh',
      });
      runInAction(() => {
        const current = this.tasks.get(params.id);
        if (current && isUnregistered(current)) {
          current.phase = 'create-error';
          current.errorMessage = message;
        }
      });
      throw new Error(message);
    }

    runInAction(() => {
      const current = this.tasks.get(params.id);
      if (current && isUnregistered(current)) {
        current.transitionToUnprovisioned(result.data.task, 'provision');
        // For repository-instance tasks the workspace ID is known at creation time —
        // set it immediately so consumers can reference it before provisioning completes.
        if (
          params.workspaceConfig.workspace.kind === 'repository-instance' &&
          result.data.task.workspaceId
        ) {
          current.workspaceId = result.data.task.workspaceId;
        }
        if (result.data.task.workspaceId) {
          this._watchWorkspaceBootstrap(result.data.task.id, result.data.task.workspaceId);
        }
      }
    });

    this._settingsStore.pageData.invalidate();

    if (result.data.warning) {
      toast.error(formatCreateTaskWarning(result.data.warning));
    }

    await this.provisionTask(params.id);
  }

  async provisionTask(taskId: string): Promise<void> {
    await appState.projects.mountProject(this.projectId);
    await this.loadTasks();

    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    runInAction(() => {
      task.phase = 'provision';
      task.errorMessage = undefined;
      task.provisionError = null;
      task.provisionProgress = null;
      task.provisionProgressMessage = null;
    });

    const promise = this._doProvision(taskId).finally(() => {
      this._provisionPromises.delete(taskId);
    });

    this._provisionPromises.set(taskId, promise);
    return promise;
  }

  private async _doProvision(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    const wsId = (task.data as Task).workspaceId;
    if (!wsId) {
      const message = 'This task does not have a workspace record and cannot be opened.';
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'provision-error';
          current.errorMessage = message;
          current.provisionError = {
            type: 'missing-workspace',
            message,
          };
        }
      });
      return;
    }

    // Single-phase provision: workspace bootstrap + task provider construction + registration.
    workspaceRegistry.setBootstrapState(wsId, { kind: 'resolving' });
    this._watchWorkspaceBootstrap(taskId, wsId);

    const client = await getWorkspacesWireClient();
    const jobs = createLiveJobReplica(workspacesWireContract.provision, client.provision);
    const lease = await jobs.start({ workspaceId: wsId, taskId });
    const job = await lease.ready();

    let result:
      | { success: true; data: Awaited<typeof job.result> }
      | { success: false; error: WorkspaceError };
    try {
      result = { success: true, data: await job.result };
    } catch (error) {
      result = { success: false, error: wireErrorToWorkspaceError(error) };
    } finally {
      await lease.release();
      await jobs.dispose();
    }

    if (!result.success) {
      const message = formatProvisionWorkspaceError(result.error);
      workspaceRegistry.setBootstrapState(wsId, { kind: 'error', message });
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'provision-error';
          current.errorMessage = message;
          current.provisionError = result.error;
        }
      });
      return;
    }

    workspaceRegistry.setBootstrapState(wsId, { kind: 'ready' });

    const taskBeforeTransition = this.tasks.get(taskId);
    if (taskBeforeTransition && isUnprovisioned(taskBeforeTransition)) {
      await taskBeforeTransition.ready();
    }

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isUnprovisioned(current)) {
        current.transitionToProvisioned(
          { ...current.data, lastInteractedAt: new Date().toISOString() },
          result.data.path,
          result.data.workspaceId,
          result.data.sshConnectionId ?? undefined
        );
        current.activate();
      }
    });
  }

  private async _doHandleProvisioned(
    taskId: string,
    path: string,
    workspaceId: string,
    sshConnectionId?: string
  ): Promise<void> {
    const taskBeforeTransition = this.tasks.get(taskId);
    if (taskBeforeTransition && isUnprovisioned(taskBeforeTransition)) {
      await taskBeforeTransition.ready();
    }
    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isUnprovisioned(current)) {
        current.transitionToProvisioned(
          { ...current.data, lastInteractedAt: new Date().toISOString() },
          path,
          workspaceId,
          sshConnectionId
        );
        current.activate();
      }
    });
  }

  private _watchWorkspaceBootstrap(taskId: string, workspaceId: string): void {
    if (this._bootstrapDisposers.has(taskId)) return;

    const pending = { disposed: false };
    this._bootstrapDisposers.set(taskId, () => {
      pending.disposed = true;
    });

    void (async () => {
      const replica = await this._getBootstrapReplica();
      const lease = replica.acquire({ workspaceId });
      const model = await lease.ready();
      if (pending.disposed) {
        await lease.release();
        return;
      }

      const unsubscribe = model.states.state.onChange((state) =>
        this._handleBootstrapState(taskId, state)
      );
      this._handleBootstrapState(taskId, model.states.state.current());
      this._bootstrapDisposers.set(taskId, () => {
        pending.disposed = true;
        unsubscribe();
        void lease.release();
      });
    })().catch((error: unknown) => {
      log.warn('Failed to watch workspace bootstrap state', { error });
      this._bootstrapDisposers.delete(taskId);
    });
  }

  private _handleBootstrapState(taskId: string, state: WorkspaceBootstrapState): void {
    const store = this.tasks.get(taskId);
    if (!store) return;

    if (state.status === 'provisioning' && isUnprovisioned(store)) {
      const workspaceId = store.data.workspaceId;
      if (workspaceId) {
        workspaceRegistry.setBootstrapState(workspaceId, { kind: 'resolving' });
      }
      runInAction(() => {
        store.phase = 'provision';
        store.provisionProgress = state.progress ?? null;
        store.provisionError = null;
        store.provisionProgressMessage = state.progress?.message ?? 'Setting up workspace…';
      });
      return;
    }

    if (state.status === 'error' && isUnprovisioned(store)) {
      const message = formatProvisionWorkspaceError(state.error);
      runInAction(() => {
        store.phase = 'provision-error';
        store.errorMessage = message;
        store.provisionProgress = state.progress ?? store.provisionProgress;
        store.provisionProgressMessage = state.progress?.message ?? store.provisionProgressMessage;
        store.provisionError = state.error;
      });
      return;
    }

    if (state.status === 'ready') {
      void this._doHandleProvisioned(
        taskId,
        state.result.path,
        state.result.workspaceId,
        state.result.sshConnectionId
      );
    }
  }

  private async _getBootstrapReplica(): Promise<
    LiveModelReplica<typeof workspacesWireContract.bootstrap>
  > {
    if (!this._bootstrapReplicaPromise) {
      this._bootstrapReplicaPromise = getWorkspacesWireClient().then((client) =>
        createLiveModelReplica(workspacesWireContract.bootstrap, client.bootstrap)
      );
    }
    return this._bootstrapReplicaPromise;
  }

  async teardownTask(taskId: string): Promise<void> {
    const inFlight = this._teardownPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task) return;

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (!current) return;
      if (isProvisioned(current)) {
        current.transitionToUnprovisioned({ ...current.data }, 'teardown');
      } else if (isUnprovisioned(current)) {
        current.phase = 'teardown';
      }
    });

    const promise = getDesktopWireClient()
      .then((client) => client.tasks.teardownTask({ projectId: this.projectId, taskId }))
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'idle';
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'teardown-error';
          }
        });
        throw err;
      })
      .finally(() => {
        this._teardownPromises.delete(taskId);
      });

    this._teardownPromises.set(taskId, promise);
    return promise;
  }

  async setTaskPinned(taskId: string, isPinned: boolean): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await task.setPinned(isPinned);
  }

  private async _renameTask(
    task: Task,
    name: string
  ): Promise<SharedResult<RenameTaskSuccess, RenameTaskError>> {
    const result = await this._runTaskListMutation(
      (member) => member.mutations.rename,
      { taskId: task.id, newName: name },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id);
        if (target) target.name = name;
      }
    );
    if (!result.success) return err(result.error);
    return ok(result.data.data);
  }

  private async _updateTaskStatus(task: Task, status: TaskLifecycleStatus): Promise<void> {
    const changedAt = new Date().toISOString();
    const result = await this._runTaskListMutation(
      (member) => member.mutations.setStatus,
      { taskId: task.id, status },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id);
        if (!target) return;
        target.status = status;
        target.statusChangedAt = changedAt;
      }
    );
    throwIfMutationFailed(result);
  }

  private async _setTaskPinned(task: Task, isPinned: boolean): Promise<void> {
    const result = await this._runTaskListMutation(
      (member) => member.mutations.setPinned,
      { taskId: task.id, isPinned },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id);
        if (target) target.isPinned = isPinned;
      }
    );
    throwIfMutationFailed(result);
  }

  private async _updateLinkedIssue(task: Task, issue?: LinkedIssue): Promise<void> {
    const result = await this._runTaskListMutation(
      (member) => member.mutations.setLinkedIssue,
      { taskId: task.id, issue },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id);
        if (target) target.linkedIssue = issue;
      }
    );
    throwIfMutationFailed(result);
  }

  private async _convertAutomationTask(task: Task): Promise<void> {
    const result = await this._runTaskListMutation(
      (member) => member.mutations.convertAutomation,
      { taskId: task.id },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id);
        if (target) target.type = 'task';
      }
    );
    throwIfMutationFailed(result);
  }

  async archiveTask(taskId: string): Promise<void> {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return;
    const archivedAt = new Date().toISOString();
    const result = await this._runTaskListMutation(
      (member) => member.mutations.archive,
      { taskId },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === taskId);
        if (target) target.archivedAt = archivedAt;
      }
    );
    throwIfMutationFailed(result);

    runInAction(() => {
      const task = this.tasks.get(taskId);
      if (task && isRegistered(task)) {
        task.transitionToDryUnprovisioned({ ...task.data }, 'idle');
      }
    });
    const current = appState.navigation.currentRef;
    if (current.viewId === 'task' && (current.params as { taskId?: string }).taskId === taskId) {
      appState.navigation.navigate(projectViewDef({ projectId: this.projectId }));
    }
    appState.navigation.invalidateSubject(taskSubject({ taskId }));
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const result = await this._runTaskListMutation(
      (member) => member.mutations.restore,
      { taskId },
      (draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === taskId);
        if (target) target.archivedAt = undefined;
      }
    );
    throwIfMutationFailed(result);
  }

  private async _taskListMutationContext(): Promise<{
    member: TaskListRemoteMember;
    view: OptimisticView<TaskListData>;
  }> {
    await this.loadTasks();
    if (!this._taskListRemote || !this._taskListView) {
      throw new Error('Task list model is unavailable');
    }
    return {
      member: this._taskListRemote({ projectId: this.projectId }),
      view: this._taskListView,
    };
  }

  private async _runTaskListMutation<Input, Data, Error>(
    selectMutation: (
      member: TaskListRemoteMember
    ) => (
      input: Input,
      options: { mutationId: string }
    ) => Promise<TaskMutationInvocation<Data, Error>>,
    input: Input,
    recipe: (draft: TaskListData) => void
  ): Promise<SharedResult<{ data: Data; cursors: unknown[] }, Error>> {
    const { member, view } = await this._taskListMutationContext();
    return await view.run(selectMutation(member), input, recipe);
  }

  async deleteTask(taskId: string, opts?: DeleteTaskOptions): Promise<void> {
    return this.deleteTasks([taskId], opts);
  }

  async deleteTasks(taskIds: string[], opts?: DeleteTaskOptions): Promise<void> {
    const removed = new Map<string, TaskStore>();
    const tasksClient = (await getDesktopWireClient()).tasks;

    runInAction(() => {
      for (const id of taskIds) {
        const t = this.tasks.get(id);
        if (t) {
          removed.set(id, t);
          this.tasks.delete(id);
        }
      }
    });

    try {
      await tasksClient.deleteTasks({
        projectId: this.projectId,
        taskIds,
        options: opts,
      });
      removed.forEach((task) => task.dispose());
      for (const id of removed.keys()) {
        appState.navigation.invalidateSubject(taskSubject({ taskId: id }));
      }
    } catch (e) {
      runInAction(() => {
        removed.forEach((t, id) => {
          this.tasks.set(id, t);
        });
      });
      toast.error(`Could not delete ${taskIds.length === 1 ? 'task' : 'tasks'}`, {
        description: formatErrorMessage(e),
      });
      throw e;
    }
  }

  dispose(): void {
    for (const task of this.tasks.values()) {
      task.dispose();
    }
    this.tasks.clear();
    void this._taskListScope.dispose();
    void this._taskListAttemptScope?.dispose();
    void this._taskListRemote?.dispose();
    void this._taskStatsRemote?.dispose();
    for (const dispose of this._bootstrapDisposers.values()) dispose();
    this._bootstrapDisposers.clear();
    const replicaPromise = this._bootstrapReplicaPromise;
    this._bootstrapReplicaPromise = null;
    void replicaPromise?.then((replica) => replica.dispose());
  }
}

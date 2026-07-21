import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import { createLiveJobReplica, createLiveModelReplica, type LiveModelReplica } from '@emdash/wire';
import { makeObservable, observable, runInAction, toJS } from 'mobx';
import { toast } from 'sonner';
import { match } from 'ts-pattern';
import type { ProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-settings-store';
import { projectViewDef } from '@core/features/projects/contributions/views';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  type TaskStore,
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
import { getMementoClient } from '@core/primitives/mementos/browser';
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
  Task,
} from '@core/primitives/tasks/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';

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

  private _unsubTaskEvents: (() => void) | null = null;
  private _bootstrapReplicaPromise: Promise<
    LiveModelReplica<typeof workspacesWireContract.bootstrap>
  > | null = null;
  private _bootstrapDisposers = new Map<string, () => void>();

  tasks = observable.map<string, TaskStore>();

  constructor(
    projectId: string,
    settingsStore: ProjectSettingsStore,
    private readonly projectStores?: ScopedStoreLookup
  ) {
    this.projectId = projectId;
    this._settingsStore = settingsStore;
    makeObservable(this, { tasks: observable });

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.tasks.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'created') {
            const { task } = event;
            if (task.projectId !== this.projectId || this.tasks.has(task.id)) return;
            runInAction(() => {
              this.tasks.set(task.id, createUnprovisionedTask(task, this.projectStores));
            });
            if (task.workspaceId) this._watchWorkspaceBootstrap(task.id, task.workspaceId);
            return;
          }
          if (event.projectId === this.projectId) void this._removeTaskLocally(event.taskId);
        },
        onGap: () => {
          this._loadPromise = null;
          void this.loadTasks();
        },
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    this._unsubTaskEvents = () => {
      disposed = true;
      unsubscribe?.();
    };
  }

  private async _removeTaskLocally(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    runInAction(() => {
      this.tasks.delete(taskId);
    });
    appState.navigation.invalidateSubject(taskSubject({ taskId }));
    this._bootstrapDisposers.get(taskId)?.();
    this._bootstrapDisposers.delete(taskId);
    const mementos = getMementoClient();
    try {
      await mementos.deleteBySubject(taskSubject({ taskId }));
    } catch (error) {
      mementos.reportError(error);
    }
    task.dispose();
  }

  loadTasks(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = getDesktopWireClient()
        .then((client) => client.tasks.getTasks({ projectId: this.projectId }))
        .then((tasks) => {
          runInAction(() => {
            for (const t of tasks) {
              this.tasks.set(t.id, createUnprovisionedTask(t, this.projectStores));
              if (t.workspaceId) this._watchWorkspaceBootstrap(t.id, t.workspaceId);
            }
          });
        })
        .catch((e) => {
          console.error('Error loading tasks', e);
        });
    }
    return this._loadPromise;
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
          this.projectStores
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
      console.warn('Failed to watch workspace bootstrap state', error);
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

  async archiveTask(taskId: string): Promise<void> {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return;
    const previousArchivedAt = currentTask.data.archivedAt;

    try {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = new Date().toISOString();
        }
      });
      await (
        await getDesktopWireClient()
      ).tasks.archiveTask({
        projectId: this.projectId,
        taskId,
      });
    } catch (e) {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = previousArchivedAt;
        }
      });
      throw e;
    }

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
    const archivedAt = task.data.archivedAt;

    try {
      await (await getDesktopWireClient()).tasks.restoreTask({ taskId });
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = undefined;
        }
      });
    } catch (e) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = archivedAt;
        }
      });
      throw e;
    }
  }

  async deleteTask(taskId: string, opts?: DeleteTaskOptions): Promise<void> {
    return this.deleteTasks([taskId], opts);
  }

  async deleteTasks(taskIds: string[], opts?: DeleteTaskOptions): Promise<void> {
    const removed = new Map<string, TaskStore>();

    // Optimistic removal empties this.tasks before taskDeleted events arrive,
    // so record confirmations here and skip them during rollback.
    const confirmed = new Set<string>();
    const tasksClient = (await getDesktopWireClient()).tasks;
    const unsubConfirmations = await tasksClient.events.subscribe(undefined, {
      onEvent: (event) => {
        if (event.type === 'deleted' && event.projectId === this.projectId) {
          confirmed.add(event.taskId);
        }
      },
      onGap: () => {},
    });

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
      removed.forEach((task) => task.dispose());
      await tasksClient.deleteTasks({
        projectId: this.projectId,
        taskIds,
        options: opts,
      });
      for (const id of removed.keys()) {
        appState.navigation.invalidateSubject(taskSubject({ taskId: id }));
      }
    } catch (e) {
      runInAction(() => {
        removed.forEach((t, id) => {
          if (!confirmed.has(id)) this.tasks.set(id, t);
        });
      });
      toast.error(`Could not delete ${taskIds.length === 1 ? 'task' : 'tasks'}`, {
        description: formatErrorMessage(e),
      });
      throw e;
    } finally {
      unsubConfirmations();
    }
  }

  dispose(): void {
    for (const task of this.tasks.values()) {
      task.dispose();
    }
    this.tasks.clear();
    this._unsubTaskEvents?.();
    this._unsubTaskEvents = null;
    for (const dispose of this._bootstrapDisposers.values()) dispose();
    this._bootstrapDisposers.clear();
    const replicaPromise = this._bootstrapReplicaPromise;
    this._bootstrapReplicaPromise = null;
    void replicaPromise?.then((replica) => replica.dispose());
  }
}

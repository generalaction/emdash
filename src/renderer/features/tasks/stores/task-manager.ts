import { makeObservable, observable, runInAction, toJS } from 'mobx';
import { toast } from 'sonner';
import { taskPrUpdatedChannel, taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskWarning,
  Task,
  TaskLifecycleStatus,
} from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
  TaskStore,
} from './task';

function formatCreateTaskError(error: CreateTaskError): string {
  switch (error.type) {
    case 'project-not-found':
      return 'Project not found.';
    case 'initial-commit-required':
      return 'Create an initial commit to enable branch-based tasks.';
    case 'branch-create-failed': {
      switch (error.error.type) {
        case 'already_exists':
          return `Branch "${error.error.name}" already exists. Try a different task name.`;
        case 'invalid_base':
          return `Source branch "${error.error.from}" is not a valid base. Check that it exists locally or on the selected remote.`;
        case 'invalid_name':
          return `Branch "${error.error.name}" is not a valid branch name.`;
        case 'error':
          return `Could not create branch "${error.branch}": ${error.error.message}`;
      }
    }
    case 'pr-fetch-failed':
      return error.error.type === 'not_found'
        ? `PR #${error.error.prNumber} was not found on remote "${error.remote}".`
        : `Could not fetch the pull request branch: ${error.error.message}`;
    case 'branch-not-found':
      return `Branch "${error.branch}" was not found locally or on the remote. Make sure the PR branch exists.`;
    case 'worktree-setup-failed':
      return error.message
        ? `Could not set up the worktree for branch "${error.branch}": ${error.message}`
        : `Could not set up the worktree for branch "${error.branch}".`;
    case 'provision-failed':
      return `Task could not be provisioned: ${error.message}`;
  }
}

function formatCreateTaskWarning(warning: CreateTaskWarning): string {
  switch (warning.type) {
    case 'branch-publish-failed': {
      const detail =
        'message' in warning.error
          ? (warning.error.message ?? warning.error.type)
          : warning.error.type;
      return `Failed to publish branch "${warning.branch}" to "${warning.remote}": ${detail}`;
    }
  }
}

export class TaskManagerStore {
  private readonly projectId: string;
  private readonly _repository: RepositoryStore;
  private _loadPromise: Promise<void> | null = null;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();

  tasks = observable.map<string, TaskStore>();

  constructor(projectId: string, repository: RepositoryStore) {
    this.projectId = projectId;
    this._repository = repository;
    makeObservable(this, { tasks: observable });

    events.on(taskStatusUpdatedChannel, ({ taskId, projectId: evtProjectId, status }) => {
      if (evtProjectId !== this.projectId) return;
      const store = this.tasks.get(taskId);
      if (store && isProvisioned(store)) {
        runInAction(() => {
          store.data.status = status as TaskLifecycleStatus;
        });
      }
    });

    events.on(taskPrUpdatedChannel, ({ taskId, projectId: evtProjectId, prs }) => {
      if (evtProjectId !== this.projectId) return;
      const store = this.tasks.get(taskId);
      if (store && isRegistered(store)) {
        runInAction(() => {
          (store.data as Task).prs = prs;
        });
      }
    });
  }

  loadTasks(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = rpc.tasks.getTasks(this.projectId).then((tasks) => {
        runInAction(() => {
          for (const t of tasks) {
            this.tasks.set(t.id, createUnprovisionedTask(t));
          }
        });
      });
    }
    return this._loadPromise;
  }

  async createTask(params: CreateTaskParams) {
    runInAction(() => {
      this.tasks.set(
        params.id,
        createUnregisteredTask({
          id: params.id,
          lastInteractedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          name: params.name,
          status: params.initialStatus ?? 'in_progress',
          statusChangedAt: new Date().toISOString(),
          isPinned: false,
        })
      );
    });

    const sourceBranch = structuredClone(toJS(params.sourceBranch));

    const result = await rpc.tasks.createTask({ ...params, sourceBranch }).catch((e: unknown) => {
      // Network/IPC-level failure — surface as a generic error.
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
      const message = formatCreateTaskError(result.error);
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
      }
    });

    if (result.data.warning) {
      toast.error(formatCreateTaskWarning(result.data.warning));
    }

    await this.provisionTask(params.id);
  }

  async provisionTask(taskId: string): Promise<void> {
    await getProjectManagerStore().mountProject(this.projectId);
    await this.loadTasks();

    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    runInAction(() => {
      task.phase = 'provision';
    });

    const promise = Promise.all([
      rpc.tasks.provisionTask(taskId),
      rpc.viewState.get(`task:${taskId}`),
    ])
      .then(([result, savedSnapshot]) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.transitionToProvisioned(
              { ...current.data, lastInteractedAt: new Date().toISOString() },
              result.path,
              this._repository,
              savedSnapshot as TaskViewSnapshot | undefined
            );
            current.activate();
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'provision-error';
            current.errorMessage = err instanceof Error ? err.message : String(err);
          }
        });
        throw err;
      })
      .finally(() => {
        this._provisionPromises.delete(taskId);
      });

    this._provisionPromises.set(taskId, promise);
    return promise;
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

    const promise = rpc.tasks
      .teardownTask(this.projectId, taskId)
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
    try {
      await rpc.tasks.archiveTask(this.projectId, taskId);
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = new Date().toISOString();
        }
      });
      void this.teardownTask(taskId).catch(() => {});
    } catch (e) {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = undefined;
        }
      });
      throw e;
    }
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const archivedAt = task.data.archivedAt;

    try {
      await rpc.tasks.restoreTask(taskId);
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

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    runInAction(() => {
      this.tasks.delete(taskId);
    });

    try {
      task.dispose();
      await rpc.tasks.deleteTask(this.projectId, taskId);
    } catch (e) {
      runInAction(() => {
        this.tasks.set(taskId, task);
      });
      throw e;
    }
  }
}

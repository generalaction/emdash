import { makeObservable, observable, runInAction } from 'mobx';
import type { CreateTaskError, CreateTaskParams, TaskLifecycleStatus } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { rpc } from '@renderer/core/ipc';
import { getProjectManagerStore } from './project-selectors';
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
    case 'branch-not-found':
      return `Branch "${error.branch}" was not found locally or on the remote. Make sure the PR branch exists.`;
    case 'branch-already-exists':
      return `Branch "${error.branch}" already exists. Try a different task name.`;
    case 'invalid-base-branch':
      return `Source branch "${error.branch}" is not a valid base. Check that the branch exists on the remote.`;
    case 'worktree-setup-failed':
      return `Could not set up the worktree: ${error.message}`;
    case 'pr-fetch-failed':
      return `Could not fetch the pull request branch: ${error.message}`;
    case 'provision-failed':
      return `Task could not be provisioned: ${error.message}`;
  }
}

export class TaskManagerStore {
  private readonly projectId: string;
  private _loadPromise: Promise<void> | null = null;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();

  tasks = observable.map<string, TaskStore>();

  constructor(projectId: string) {
    this.projectId = projectId;
    makeObservable(this, { tasks: observable });
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
          name: params.name,
          status: params.initialStatus ?? 'in_progress',
        })
      );
    });

    const result = await rpc.tasks.createTask(params).catch((e: unknown) => {
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
        current.transitionToUnprovisioned(result.data, 'provision');
      }
    });

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
              { ...current.data },
              result.path,
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

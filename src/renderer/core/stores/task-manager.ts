import { makeObservable, observable, runInAction } from 'mobx';
import type { CreateTaskParams } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { rpc } from '@renderer/core/ipc';
import { projectManagerStore } from './project-manager';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
  TaskStore,
} from './task';

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
      this.tasks.set(params.id, createUnregisteredTask({ id: params.id, name: params.name }));
    });

    await rpc.tasks
      .createTask(params)
      .then((task) => {
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current && isUnregistered(current)) {
            current.transitionToUnprovisioned(task, 'provision');
          }
        });
        return task;
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current && isUnregistered(current)) {
            current.phase = 'create-error';
            current.errorMessage = err instanceof Error ? err.message : String(err);
          }
        });
        throw err;
      });

    await this.provisionTask(params.id);
  }

  async provisionTask(taskId: string): Promise<void> {
    await projectManagerStore.mountProject(this.projectId);
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
              result?.path ?? '',
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

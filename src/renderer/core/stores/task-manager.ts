import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import type { CreateTaskParams } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';
import { projectManagerStore } from './project-manager';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  isProvisioned,
  isUnprovisioned,
  isUnregistered,
  TaskStore,
} from './task';

export class TaskManagerStore {
  private readonly projectId: string;
  private _loaded = false;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();

  tasks = observable.map<string, TaskStore>();

  constructor(projectId: string) {
    this.projectId = projectId;
    makeObservable(this, { tasks: observable });
    onBecomeObserved(this, 'tasks', () => {
      if (this._loaded) return;
      this.loadTasks();
    });
  }

  async loadTasks(): Promise<void> {
    this._loaded = true;
    const tasks = await rpc.tasks.getTasks(this.projectId);
    runInAction(() => {
      for (const t of tasks) {
        this.tasks.set(t.id, createUnprovisionedTask(t));
      }
    });
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
            current.transitionToUnprovisioned(task);
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
    // Ensure the project is open in the main process before provisioning any task within it.
    await projectManagerStore.mountProject(this.projectId);

    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    runInAction(() => {
      task.phase = 'provision';
    });

    const promise = rpc.tasks
      .provisionTask(taskId)
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.transitionToProvisioned({ ...current.data });
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
    const task = this.tasks.get(taskId);
    if (!task || isUnregistered(task)) return;

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (!current) return;
      if (isProvisioned(current)) {
        current.transitionToUnprovisioned({ ...current.data }, 'teardown');
      } else if (isUnprovisioned(current)) {
        current.phase = 'teardown';
      }
    });

    try {
      await rpc.tasks.archiveTask(this.projectId, taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.data.archivedAt = new Date().toISOString();
          current.data.status = 'archived';
          current.phase = 'idle';
        }
      });
    } catch (err: unknown) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'teardown-error';
        }
      });
      throw err;
    }
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || isUnregistered(task)) return;

    runInAction(() => {
      if (isUnprovisioned(task)) {
        task.phase = 'provision';
      }
    });

    try {
      await rpc.tasks.restoreTask(taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.data.archivedAt = undefined;
          current.data.status = 'in_progress';
        }
      });
      await this.provisionTask(taskId);
    } catch (err: unknown) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'provision-error';
        }
      });
      throw err;
    }
  }

  async deleteTask(_taskId: string): Promise<void> {
    // should teardown task and delete from db
  }
}

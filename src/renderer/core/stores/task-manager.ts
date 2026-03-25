import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import type { CreateTaskParams } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';
import { projectManagerStore } from './project-manager';
import {
  ProvisionedTaskStore,
  TaskStore,
  UnprovisionedTaskStore,
  UnregisteredTaskStore,
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
        this.tasks.set(t.id, new UnprovisionedTaskStore(t));
      }
    });
  }

  async createTask(params: CreateTaskParams) {
    runInAction(() => {
      this.tasks.set(params.id, new UnregisteredTaskStore({ id: params.id, name: params.name }));
    });

    await rpc.tasks
      .createTask(params)
      .then((task) => {
        runInAction(() => {
          this.tasks.set(params.id, new UnprovisionedTaskStore(task));
        });
        return task;
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current?.state === 'unregistered') {
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
    if (!task || task.state !== 'unprovisioned') return;

    runInAction(() => {
      task.phase = 'provision';
    });

    const promise = rpc.tasks
      .provisionTask(taskId)
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current?.state === 'unprovisioned') {
            const store = new ProvisionedTaskStore({ ...current.data });
            this.tasks.set(taskId, store);
            store.activate();
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current?.state === 'unprovisioned') {
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
      if (current?.state === 'provisioned') {
        const store = new UnprovisionedTaskStore({ ...current.data });
        store.phase = 'teardown';
        this.tasks.set(taskId, store);
      } else if (current?.state === 'unprovisioned') {
        current.phase = 'teardown';
      }
    });

    const promise = rpc.tasks
      .teardownTask(this.projectId, taskId)
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current?.state === 'unprovisioned') {
            current.phase = 'idle';
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current?.state === 'unprovisioned') {
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
    if (!task || task.state === 'unregistered') return;

    if (task.state === 'unprovisioned') {
      runInAction(() => {
        task.phase = 'teardown';
      });
    } else {
      runInAction(() => {
        const u = new UnprovisionedTaskStore({ ...task.data });
        u.phase = 'teardown';
        this.tasks.set(taskId, u);
      });
    }

    try {
      await rpc.tasks.archiveTask(this.projectId, taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current?.state === 'unprovisioned') {
          current.data.archivedAt = new Date().toISOString();
          current.data.status = 'archived';
          current.phase = 'idle';
        }
      });
    } catch (err: unknown) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current?.state === 'unprovisioned') {
          current.phase = 'teardown-error';
        }
      });
      throw err;
    }
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.state === 'unregistered') return;

    runInAction(() => {
      if (task.state === 'unprovisioned') {
        task.phase = 'provision';
      }
    });

    try {
      await rpc.tasks.restoreTask(taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current?.state === 'unprovisioned') {
          current.data.archivedAt = undefined;
          current.data.status = 'in_progress';
        }
      });
      await this.provisionTask(taskId);
    } catch (err: unknown) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current?.state === 'unprovisioned') {
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

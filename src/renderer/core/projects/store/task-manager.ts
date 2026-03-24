import { observable, onBecomeObserved, runInAction } from 'mobx';
import { Task } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';

export class TaskManagerStore {
  projectId: string;
  isLoading = false;
  tasks = observable.map<string, TaskStore>();

  constructor(projectId: string) {
    this.projectId = projectId;
    onBecomeObserved(this, 'projectId', this.loadTasks);
  }

  async loadTasks(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
    });
    const tasks = await rpc.tasks.getTasks(this.projectId);
    for (const t of tasks) {
      runInAction(() => {
        this.tasks.set(t.id, new TaskStore(t));
      });
    }
    runInAction(() => {
      this.isLoading = false;
    });
  }

  async provisionTask(taskId: string): Promise<void> {}

  async archiveTask(taskId: string): Promise<void> {}

  async restoreTask(taskId: string): Promise<void> {}

  async deleteTask(taskId: string): Promise<void> {}
}

export class TaskStore {
  task: Task;
  constructor(task: Task) {
    this.task = task;
  }
}

export class ProvisionedTask {}

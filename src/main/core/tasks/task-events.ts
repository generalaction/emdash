import type { Task } from '@shared/tasks';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';

export type TaskCrudHooks = {
  'task:created': (task: Task) => void | Promise<void>;
  'task:updated': (task: Task) => void | Promise<void>;
  'task:archived': (taskId: string, projectId: string) => void | Promise<void>;
  'task:deleted': (taskId: string, projectId: string) => void | Promise<void>;
};

class TaskEvents implements Hookable<TaskCrudHooks> {
  private readonly _core = new HookCore<TaskCrudHooks>((name, e) =>
    log.error(`TaskEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof TaskCrudHooks>(name: K, handler: TaskCrudHooks[K]) {
    return this._core.on(name, handler);
  }

  _emit<K extends keyof TaskCrudHooks>(name: K, ...args: Parameters<TaskCrudHooks[K]>): void {
    this._core.callHookBackground(name, ...args);
  }
}

export const taskEvents = new TaskEvents();

import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { ProvisionStep } from '@shared/events/taskEvents';

type TaskProvisionProgress = {
  taskId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
};

export type TaskProvisionHooks = {
  progress: (progress: TaskProvisionProgress) => void | Promise<void>;
};

class TaskProvisionEvents implements Hookable<TaskProvisionHooks> {
  private readonly _core = new HookCore<TaskProvisionHooks>((name, e) =>
    log.error(`TaskProvisionEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof TaskProvisionHooks>(name: K, handler: TaskProvisionHooks[K]) {
    return this._core.on(name, handler);
  }

  emitProgress(progress: TaskProvisionProgress): void {
    this._core.callHookBackground('progress', progress);
  }
}

export const taskProvisionEvents = new TaskProvisionEvents();

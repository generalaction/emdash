import type { WorkspaceOperationProgress } from '@emdash/core/runtimes/workspace/api';
import { log } from '@emdash/shared/logger';
import type { WorkspaceBootstrapStep } from '@core/features/workspaces/api';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';

type TaskProvisionProgress = {
  taskId: string;
  projectId: string;
  step: WorkspaceBootstrapStep;
  message: string;
  operation?: WorkspaceOperationProgress;
};

export type TaskProvisionHooks = {
  progress: (progress: TaskProvisionProgress) => void | Promise<void>;
};

class TaskProvisionEvents implements Hookable<TaskProvisionHooks> {
  private readonly _core = new HookCore<TaskProvisionHooks>((name, e) =>
    log.error(`TaskProvisionEvents: ${String(name)} hook error`, { error: e })
  );

  on<K extends keyof TaskProvisionHooks>(name: K, handler: TaskProvisionHooks[K]) {
    return this._core.on(name, handler);
  }

  emitProgress(progress: TaskProvisionProgress): void {
    this._core.callHookBackground('progress', progress);
  }
}

export const taskProvisionEvents = new TaskProvisionEvents();

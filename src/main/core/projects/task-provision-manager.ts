import type { Conversation } from '@shared/conversations';
import { err, ok, type Result } from '@shared/result';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import type { TeardownMode } from '../workspaces/workspace-registry';
import type {
  ProvisionResult,
  ProvisionTaskError,
  TaskProvider,
  TeardownTaskError,
} from './project-provider';
import {
  formatProvisionTaskError,
  TASK_TIMEOUT_MS,
  toProvisionError,
  toTeardownError,
} from './provision-task-error';
import { withTimeout } from './utils';

type ProvisionFn = (
  task: Task,
  conversations: Conversation[],
  terminals: Terminal[]
) => Promise<ProvisionResult>;

type TeardownFn = (task: TaskProvider, workspaceId: string, mode: TeardownMode) => Promise<void>;

type DetachedCleanupFn = (taskId: string) => Promise<void>;

export type TeardownAllOpts = { mode: TeardownMode };

export class TaskProvisionManager {
  private readonly _lifecycle = new LifecycleMap<ProvisionResult, ProvisionTaskError>();

  constructor(
    private readonly logPrefix: string,
    private readonly provisionFn: ProvisionFn,
    private readonly teardownFn: TeardownFn,
    private readonly detachedCleanupFn: DetachedCleanupFn,
    private readonly onTeardownFinally?: (taskId: string) => void
  ) {}

  async provisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<ProvisionResult, ProvisionTaskError>> {
    return this._lifecycle.provision(task.id, async () => {
      try {
        const result = await withTimeout(
          this.provisionFn(task, conversations, terminals),
          TASK_TIMEOUT_MS
        );
        return ok(result);
      } catch (e) {
        const provisionError = toProvisionError(e);
        log.error(`${this.logPrefix}: failed to provision task`, {
          taskId: task.id,
          error: String(e),
        });
        return err(provisionError);
      }
    });
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this._lifecycle.get(taskId)?.taskProvider;
  }

  getWorkspaceId(taskId: string): string | undefined {
    return this._lifecycle.get(taskId)?.persistData.workspaceId;
  }

  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus {
    return this._lifecycle.bootstrapStatus(taskId, formatProvisionTaskError);
  }

  async teardownTask(
    taskId: string,
    mode: TeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return (
      this._lifecycle.teardown(
        taskId,
        async (provisionResult) => {
          const { taskProvider, persistData } = provisionResult;
          try {
            await withTimeout(
              this.teardownFn(taskProvider, persistData.workspaceId, mode),
              TASK_TIMEOUT_MS
            );
            return ok();
          } catch (e) {
            log.error(`${this.logPrefix}: failed to teardown task`, {
              taskId,
              error: String(e),
            });
            await this.detachedCleanupFn(taskId).catch((cleanupError) => {
              log.warn(`${this.logPrefix}: fallback cleanup failed`, {
                taskId,
                error: String(cleanupError),
              });
            });
            return err<TeardownTaskError>(toTeardownError(e));
          }
        },
        () => this.onTeardownFinally?.(taskId)
      ) ?? (await this.detachedCleanupFn(taskId).then(() => ok()))
    );
  }

  async teardownAll(opts: TeardownAllOpts): Promise<void> {
    if (opts.mode === 'detach') {
      await Promise.all(
        Array.from(this._lifecycle.values()).map((r) =>
          Promise.all([
            r.taskProvider.conversations.detachAll(),
            r.taskProvider.terminals.detachAll(),
          ])
        )
      );
      this._lifecycle.clearActive();
    } else {
      await Promise.all(
        Array.from(this._lifecycle.keys()).map((id) => this.teardownTask(id, 'terminate'))
      );
    }
  }
}

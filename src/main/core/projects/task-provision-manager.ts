import type { Conversation } from '@shared/conversations';
import { err, ok, type Result } from '@shared/result';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
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
  private readonly _tasks = new Map<string, TaskProvider>();
  private readonly _workspaceIds = new Map<string, string>();
  private readonly _provisioningTasks = new Map<
    string,
    Promise<Result<ProvisionResult, ProvisionTaskError>>
  >();
  private readonly _tearingDownTasks = new Map<string, Promise<Result<void, TeardownTaskError>>>();
  private readonly _bootstrapErrors = new Map<string, ProvisionTaskError>();

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
    const existing = this._tasks.get(task.id);
    if (existing) {
      const workspaceId = this._workspaceIds.get(task.id) ?? '';
      return ok({ taskProvider: existing, persistData: { workspaceId } });
    }

    const inFlight = this._provisioningTasks.get(task.id);
    if (inFlight) return inFlight;

    const promise = withTimeout(this.provisionFn(task, conversations, terminals), TASK_TIMEOUT_MS)
      .then(({ taskProvider, persistData }) => {
        this._tasks.set(task.id, taskProvider);
        this._workspaceIds.set(task.id, persistData.workspaceId);
        this._provisioningTasks.delete(task.id);
        return ok({ taskProvider, persistData });
      })
      .catch((e) => {
        const provisionError = toProvisionError(e);
        this._bootstrapErrors.set(task.id, provisionError);
        this._provisioningTasks.delete(task.id);
        log.error(`${this.logPrefix}: failed to provision task`, {
          taskId: task.id,
          error: String(e),
        });
        return err(provisionError);
      });

    this._provisioningTasks.set(task.id, promise);
    return promise;
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this._tasks.get(taskId);
  }

  getWorkspaceId(taskId: string): string | undefined {
    return this._workspaceIds.get(taskId);
  }

  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus {
    if (this._tasks.has(taskId)) return { status: 'ready' };
    if (this._provisioningTasks.has(taskId)) return { status: 'bootstrapping' };
    const bootstrapError = this._bootstrapErrors.get(taskId);
    if (bootstrapError)
      return { status: 'error', message: formatProvisionTaskError(bootstrapError) };
    return { status: 'not-started' };
  }

  async teardownTask(
    taskId: string,
    mode: TeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    const inFlight = this._tearingDownTasks.get(taskId);
    if (inFlight) return inFlight;

    const task = this._tasks.get(taskId);
    if (!task) {
      await this.detachedCleanupFn(taskId);
      return ok();
    }

    const workspaceId = this._workspaceIds.get(taskId) ?? '';
    const promise = withTimeout(this.teardownFn(task, workspaceId, mode), TASK_TIMEOUT_MS)
      .then(() => ok<void>())
      .catch(async (e) => {
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
      })
      .finally(() => {
        this._tasks.delete(taskId);
        this._workspaceIds.delete(taskId);
        this._tearingDownTasks.delete(taskId);
        this.onTeardownFinally?.(taskId);
      });

    this._tearingDownTasks.set(taskId, promise);
    return promise;
  }

  async teardownAll(opts: TeardownAllOpts): Promise<void> {
    if (opts.mode === 'detach') {
      await Promise.all(
        Array.from(this._tasks.values()).map((task) =>
          Promise.all([task.conversations.detachAll(), task.terminals.detachAll()])
        )
      );
      this._tasks.clear();
      this._workspaceIds.clear();
    } else {
      await Promise.all(
        Array.from(this._tasks.keys()).map((id) => this.teardownTask(id, 'terminate'))
      );
    }
  }
}

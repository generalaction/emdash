import { KeyedMutex } from '@emdash/core/lib';
import { err, ok, type Result } from '@emdash/shared';
import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import {
  workspaceBootstrapService,
  type WorkspaceBootstrapResult,
} from '@main/core/workspaces/workspace-bootstrap-service';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  taskCreatedChannel,
  taskDeletedChannel,
  taskProvisionedChannel,
} from '@shared/core/tasks/taskEvents';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  DeleteTaskOptions,
  ProvisionTaskResult,
  ProvisionWorkspaceError,
  RenameTaskError,
  RenameTaskSuccess,
  Task,
} from '@shared/core/tasks/tasks';
import { archiveTask } from './operations/archiveTask';
import { beginTaskProvisioning } from './operations/beginTaskProvisioning';
import { createTask } from './operations/createTask';
import { deleteTask } from './operations/deleteTask';
import { getDeletePreflight } from './operations/getDeletePreflight';
import { getTasks } from './operations/getTasks';
import { persistTaskProvisioned } from './operations/persistTaskProvisioned';
import { persistTaskResourceTeardown } from './operations/persistTaskResourceTeardown';
import { renameTask } from './operations/renameTask';
import { restoreTask } from './operations/restoreTask';
import { setTaskPinned } from './operations/setTaskPinned';
import { updateLinkedIssue } from './operations/updateLinkedIssue';
import { updateTaskStatus } from './operations/updateTaskStatus';
import type { TeardownTaskError } from './provision-task-error';
import { taskSessionManager } from './task-session-manager';
import { mapTaskRowToTask } from './utils/utils';

type ProvisionResult = ProvisionTaskResult & { sshConnectionId?: string };

export type TaskLifecycleHooks = {
  'task:created': (task: Task, params: CreateTaskParams) => void | Promise<void>;
  'task:updated': (task: Task) => void | Promise<void>;
  'task:archived': (taskId: string, projectId: string) => void | Promise<void>;
  'task:deleted': (taskId: string, projectId: string) => void | Promise<void>;
  'task:workspace-ready': (taskId: string, result: ProvisionResult) => void | Promise<void>;
};

export class TaskService implements Hookable<TaskLifecycleHooks> {
  private readonly _hooks = new HookCore<TaskLifecycleHooks>((name, e) =>
    log.error(`TaskService: ${String(name)} hook error`, e)
  );
  private readonly _lifecycleMutex = new KeyedMutex();

  on<K extends keyof TaskLifecycleHooks>(name: K, handler: TaskLifecycleHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async createTask(params: CreateTaskParams): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
    const result = await createTask(params);
    if (result.success) {
      this.notifyTaskCreated(result.data.task, params);
    }
    return result;
  }

  /** Fires the task:created hook and event. Call this after committing a task insert
   *  that was performed outside of `createTask` (e.g. inside an external transaction). */
  notifyTaskCreated(task: Task, params: CreateTaskParams): void {
    this._hooks.callHookBackground('task:created', task, params);
    events.emit(taskCreatedChannel, { task });
  }

  /**
   * Provisions the workspace for a task: ensures the path is on disk, acquires
   * the workspace (running lifecycle scripts), builds task providers, and
   * registers the task session. Idempotent — fast-paths when already provisioned.
   * Fires the `task:workspace-ready` hook and emits the `task:provisioned` IPC
   * event on success so the renderer can react regardless of which path (renderer
   * or automation) triggered the provision.
   */
  async provisionWorkspace(
    taskId: string
  ): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    return this._lifecycleMutex.runExclusive(taskId, () => this._provisionWorkspace(taskId));
  }

  private async _provisionWorkspace(
    taskId: string
  ): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.archivedAt) throw new Error(`Cannot provision archived task: ${taskId}`);
    const { projectId } = row;

    // Idempotency: task is already live — return current state.
    const existingTask = taskSessionManager.getTask(taskId);
    if (existingTask) {
      const pd = taskSessionManager.getPersistData(taskId);
      const wsId = pd?.workspaceId ?? '';
      const provisionResult: ProvisionResult = {
        path: workspaceRegistry.get(wsId)?.path ?? '',
        workspaceId: wsId,
        sshConnectionId: pd?.sshConnectionId,
      };
      this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
      events.emit(taskProvisionedChannel, { taskId, projectId, ...provisionResult });
      return ok(provisionResult);
    }

    await beginTaskProvisioning(taskId);
    const result = await workspaceBootstrapService.ensureWorkspaceSetupForTask(taskId);
    if (!result.success) return err(result.error);

    await this._registerAndPersist(taskId, result.data);

    const provisionResult: ProvisionResult = {
      path: result.data.path,
      workspaceId: result.data.workspaceId,
      sshConnectionId: result.data.sshConnectionId,
    };

    this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
    events.emit(taskProvisionedChannel, { taskId, projectId, ...provisionResult });
    return ok(provisionResult);
  }

  /**
   * Phases 1+2 combined: provisions workspace then session.
   * Used by the automation path which runs entirely in the main process.
   */
  async launch(taskId: string): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    return this.provisionWorkspace(taskId);
  }

  private async _registerAndPersist(taskId: string, data: WorkspaceBootstrapResult): Promise<void> {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const task = mapTaskRowToTask(row);
    const project = projectManager.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    await persistTaskProvisioned(taskId, data.workspaceId);
    await taskSessionManager.registerTask(taskId, data, task.projectId, project.ctx);

    // BYOI: persist the provider data (remote workspace ID, connection details) returned by
    // the provision script so it can be reused on the next session.
    if (data.workspaceProviderData) {
      await db
        .update(workspaces)
        .set({
          data: data.workspaceProviderData,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(workspaces.id, data.workspaceId));
    }
  }

  async teardown(
    taskId: string,
    mode: Parameters<typeof taskSessionManager.teardownTask>[1] = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return this._lifecycleMutex.runExclusive(taskId, async () => {
      const wasLive = taskSessionManager.getTask(taskId) != null;
      const result = await taskSessionManager.teardownTask(taskId, mode);
      if (result.success && mode === 'terminate' && wasLive) {
        await persistTaskResourceTeardown(taskId);
      }
      return result;
    });
  }

  async getDeletePreflight(projectId: string, taskIds: string[]) {
    return getDeletePreflight(projectId, taskIds);
  }

  async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions): Promise<void> {
    await this._lifecycleMutex.runExclusive(taskId, async () => {
      await deleteTask(projectId, taskId, options);
      this.notifyTaskDeleted(taskId, projectId);
    });
  }

  notifyTaskDeleted(taskId: string, projectId: string): void {
    this._hooks.callHookBackground('task:deleted', taskId, projectId);
    events.emit(taskDeletedChannel, { taskId, projectId });
  }

  async deleteTasks(
    projectId: string,
    taskIds: string[],
    options?: DeleteTaskOptions
  ): Promise<void> {
    // Notify per deletion: one failure must not suppress taskDeleted for the
    // already-removed tasks, or the renderer rollback would resurrect them.
    const results = await Promise.allSettled(
      taskIds.map((id) => this.deleteTask(projectId, id, options))
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) throw failure.reason;
  }

  async archiveTask(projectId: string, taskId: string): Promise<void> {
    await this._lifecycleMutex.runExclusive(taskId, async () => {
      await archiveTask(projectId, taskId);
      this._hooks.callHookBackground('task:archived', taskId, projectId);
    });
  }

  async restoreTask(id: string): Promise<void> {
    await this._lifecycleMutex.runExclusive(id, async () => {
      const task = await restoreTask(id);
      if (task) this._hooks.callHookBackground('task:updated', task);
    });
  }

  async renameTask(
    projectId: string,
    taskId: string,
    newName: string
  ): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
    const result = await renameTask(projectId, taskId, newName);
    if (result.success) this._hooks.callHookBackground('task:updated', result.data.task);
    return result;
  }

  async updateLinkedIssue(taskId: string, issue?: LinkedIssue): Promise<void> {
    const task = await updateLinkedIssue(taskId, issue);
    if (task) this._hooks.callHookBackground('task:updated', task);
  }

  async convertAutomationTask(taskId: string): Promise<Task | null> {
    const [row] = await db
      .update(tasks)
      .set({ type: 'task', updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, taskId))
      .returning();
    if (!row) return null;

    const task: Task = { ...mapTaskRowToTask(row), prs: [], conversations: {} };
    this._hooks.callHookBackground('task:updated', task);
    return task;
  }

  // Operations with no hook — thin pass-throughs
  updateTaskStatus = updateTaskStatus;
  setTaskPinned = setTaskPinned;
  getTasks = getTasks;
}

export const taskService = new TaskService();

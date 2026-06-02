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
import { taskCreatedChannel, taskProvisionedChannel } from '@shared/events/taskEvents';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  DeleteTaskOptions,
  Issue,
  ProvisionTaskResult,
  ProvisionWorkspaceError,
  RenameTaskError,
  RenameTaskOptions,
  RenameTaskSuccess,
  Task,
} from '@shared/tasks';
import { archiveTask } from './operations/archiveTask';
import { convertAutomationTask } from './operations/convertAutomationTask';
import { createTask } from './operations/createTask';
import { deleteTask } from './operations/deleteTask';
import { getDeletePreflight } from './operations/getDeletePreflight';
import { getTasks } from './operations/getTasks';
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

/** @deprecated Use TaskLifecycleHooks */
export type TaskCrudHooks = TaskLifecycleHooks;

export class TaskService implements Hookable<TaskLifecycleHooks> {
  private readonly _hooks = new HookCore<TaskLifecycleHooks>((name, e) =>
    log.error(`TaskService: ${String(name)} hook error`, e)
  );

  on<K extends keyof TaskLifecycleHooks>(name: K, handler: TaskLifecycleHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async createTask(params: CreateTaskParams): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
    const result = await createTask(params);
    if (result.success) {
      this._hooks.callHookBackground('task:created', result.data.task, params);
      events.emit(taskCreatedChannel, { task: result.data.task });
    }
    return result;
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
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);
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

    await taskSessionManager.registerTask(taskId, data, task.projectId, project.ctx);

    await db
      .update(tasks)
      .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP`, workspaceId: data.workspaceId })
      .where(eq(tasks.id, taskId));

    // BYOI: persist the provider data (remote workspace ID, connection details) returned by
    // the provision script so it can be reused on the next session.
    if (data.workspaceProviderData) {
      await db
        .update(workspaces)
        .set({
          data: JSON.stringify(data.workspaceProviderData),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(workspaces.id, data.workspaceId));
    }
  }

  async teardown(
    taskId: string,
    mode: Parameters<typeof taskSessionManager.teardownTask>[1] = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return taskSessionManager.teardownTask(taskId, mode);
  }

  async getDeletePreflight(projectId: string, taskIds: string[]) {
    return getDeletePreflight(projectId, taskIds);
  }

  async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions): Promise<void> {
    await deleteTask(projectId, taskId, options);
    this._hooks.callHookBackground('task:deleted', taskId, projectId);
  }

  async deleteTasks(
    projectId: string,
    taskIds: string[],
    options?: DeleteTaskOptions
  ): Promise<void> {
    await Promise.all(taskIds.map((id) => deleteTask(projectId, id, options)));
    taskIds.forEach((id) => this._hooks.callHookBackground('task:deleted', id, projectId));
  }

  async archiveTask(projectId: string, taskId: string): Promise<void> {
    await archiveTask(projectId, taskId);
    this._hooks.callHookBackground('task:archived', taskId, projectId);
  }

  async restoreTask(id: string): Promise<void> {
    const task = await restoreTask(id);
    if (task) this._hooks.callHookBackground('task:updated', task);
  }

  async renameTask(
    projectId: string,
    taskId: string,
    newName: string,
    options?: RenameTaskOptions
  ): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
    const result = await renameTask(projectId, taskId, newName, options);
    if (result.success) this._hooks.callHookBackground('task:updated', result.data.task);
    return result;
  }

  async updateLinkedIssue(taskId: string, issue?: Issue): Promise<void> {
    const task = await updateLinkedIssue(taskId, issue);
    if (task) this._hooks.callHookBackground('task:updated', task);
  }

  async convertAutomationTask(taskId: string): Promise<Task | null> {
    const task = await convertAutomationTask(taskId);
    if (task) this._hooks.callHookBackground('task:updated', task);
    return task;
  }

  // Operations with no hook — thin pass-throughs
  updateTaskStatus = updateTaskStatus;
  setTaskPinned = setTaskPinned;
  getTasks = getTasks;
}

export const taskService = new TaskService();

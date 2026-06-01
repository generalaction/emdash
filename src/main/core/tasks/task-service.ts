import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { taskCreatedChannel } from '@shared/events/taskEvents';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  DeleteTaskOptions,
  Issue,
  ProvisionTaskResult,
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
import { type ProvisionTaskError, type TeardownTaskError } from './provision-task-error';
import { taskManager, type WorkspaceHint } from './task-manager';
import { mapTaskRowToTask } from './utils/utils';

export type TaskCrudHooks = {
  'task:created': (task: Task, params: CreateTaskParams) => void | Promise<void>;
  'task:updated': (task: Task) => void | Promise<void>;
  'task:archived': (taskId: string, projectId: string) => void | Promise<void>;
  'task:deleted': (taskId: string, projectId: string) => void | Promise<void>;
};

type ProvisionResult = ProvisionTaskResult & { sshConnectionId?: string };

export class TaskService implements Hookable<TaskCrudHooks> {
  private readonly _hooks = new HookCore<TaskCrudHooks>((name, e) =>
    log.error(`TaskService: ${String(name)} hook error`, e)
  );

  on<K extends keyof TaskCrudHooks>(name: K, handler: TaskCrudHooks[K]) {
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

  async provision(taskId: string): Promise<Result<ProvisionResult, ProvisionTaskError>> {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const task = mapTaskRowToTask(row);
    const project = projectManager.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    // Idempotency: task is already live — return current state.
    const existingTask = taskManager.getTask(taskId);
    if (existingTask) {
      const pd = taskManager.getPersistData(taskId);
      const wsId = pd?.workspaceId ?? '';
      return ok({
        path: workspaceRegistry.get(wsId)?.path ?? '',
        workspaceId: wsId,
        sshConnectionId: pd?.sshConnectionId,
      });
    }

    if (!row.workspaceId) throw new Error(`Task ${taskId} has no workspace — cannot provision`);

    const workspaceRow = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId))
      .then((r) => r[0]);

    if (!workspaceRow) {
      throw new Error(`Workspace ${row.workspaceId} not found for task ${taskId}`);
    }

    // Workspace path is set by `provisionWorkspace` (phase 1) before this RPC is called.
    const hint: WorkspaceHint = {
      id: workspaceRow.id,
      type: workspaceRow.type,
      path: workspaceRow.path ?? undefined,
    };

    const result = await taskManager.provisionTask(project, task, hint);
    if (!result.success) return err(result.error);

    const { persistData } = result.data;
    const workspacePath = workspaceRegistry.get(persistData.workspaceId)?.path ?? '';

    await db
      .update(tasks)
      .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP`, workspaceId: persistData.workspaceId })
      .where(eq(tasks.id, taskId));

    // BYOI: persist the provider data (remote workspace ID, connection details) returned by
    // the provision script so it can be reused on the next session.
    if (workspaceRow.type === 'byoi' && persistData.workspaceProviderData) {
      await db
        .update(workspaces)
        .set({
          data: JSON.stringify(persistData.workspaceProviderData),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(workspaces.id, workspaceRow.id));
    }

    return ok({
      path: workspacePath,
      workspaceId: persistData.workspaceId,
      sshConnectionId: persistData.sshConnectionId,
    });
  }

  async teardown(
    taskId: string,
    mode: Parameters<typeof taskManager.teardownTask>[1] = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return taskManager.teardownTask(taskId, mode);
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

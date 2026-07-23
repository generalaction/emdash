import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import { taskEvents } from '@core/features/tasks/node';
import type {
  WorkspaceBootstrapService,
  WorkspaceBootstrapResult,
} from '@core/features/workspaces/api/node/workspace-bootstrap-service';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
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
} from '@core/primitives/tasks/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';
import { archiveTask } from '../../node/operations/archiveTask';
import { createTask } from '../../node/operations/createTask';
import { deleteTask } from '../../node/operations/deleteTask';
import { getDeletePreflight } from '../../node/operations/getDeletePreflight';
import { getTasks } from '../../node/operations/getTasks';
import { renameTask } from '../../node/operations/renameTask';
import { restoreTask } from '../../node/operations/restoreTask';
import { setTaskPinned } from '../../node/operations/setTaskPinned';
import { updateLinkedIssue } from '../../node/operations/updateLinkedIssue';
import { updateTaskStatus } from '../../node/operations/updateTaskStatus';
import type { TeardownTaskError } from '../../node/provision-task-error';

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
    log.error(`TaskService: ${String(name)} hook error`, { error: e })
  );

  constructor(
    private readonly dependencies: {
      db: AppDb;
      projects: Pick<ProjectSessionManager, 'getProject'>;
      sessions: TaskSessionManager;
      workspaceBootstrap: WorkspaceBootstrapService;
      workspaceIdentity: {
        resolve(workspaceId: string): Promise<{ path: string } | null>;
      };
    }
  ) {}

  on<K extends keyof TaskLifecycleHooks>(name: K, handler: TaskLifecycleHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async createTask(
    operations: OperationsEngine,
    params: CreateTaskParams
  ): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
    const result = await createTask(
      this.dependencies.db,
      this.dependencies.projects,
      operations,
      params
    );
    if (result.success) {
      this.notifyTaskCreated(result.data.task, params);
    }
    return result;
  }

  /** Fires the task:created hook and event. Call this after committing a task insert
   *  that was performed outside of `createTask` (e.g. inside an external transaction). */
  notifyTaskCreated(task: Task, params: CreateTaskParams): void {
    this._hooks.callHookBackground('task:created', task, params);
    taskEvents.emit(undefined, { type: 'created', task });
  }

  /**
   * Provisions the workspace for a task: ensures the path is on disk, acquires
   * the workspace (running lifecycle scripts), builds task providers, and
   * registers the task session. Idempotent — fast-paths when already provisioned.
   * Fires the `task:workspace-ready` hook on success so the workspaces wire host
   * can publish durable status to renderer replicas.
   */
  async provisionWorkspace(
    taskId: string
  ): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    const [row] = await this.dependencies.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    const { projectId } = row;

    // Idempotency: task is already live — return current state.
    const existingTask = this.dependencies.sessions.getTask(taskId);
    if (existingTask) {
      const pd = this.dependencies.sessions.getPersistData(taskId);
      const wsId = pd?.workspaceId ?? '';
      const identity = wsId ? await this.dependencies.workspaceIdentity.resolve(wsId) : null;
      const provisionResult: ProvisionResult = {
        path: identity?.path ?? '',
        workspaceId: wsId,
        sshConnectionId: pd?.sshConnectionId,
      };
      this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
      return ok(provisionResult);
    }

    const result = await this.dependencies.workspaceBootstrap.ensureWorkspaceSetupForTask(taskId);
    if (!result.success) return err(result.error);

    await this._registerAndPersist(taskId, result.data);

    const provisionResult: ProvisionResult = {
      path: result.data.path,
      workspaceId: result.data.workspaceId,
      sshConnectionId: result.data.sshConnectionId,
    };

    this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
    const project = this.dependencies.projects.getProject(projectId);
    if (project) {
      this.dependencies.workspaceBootstrap.startPostActivationScripts(
        mapTaskRowToTask(row),
        project,
        result.data
      );
    }
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
    const [row] = await this.dependencies.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const task = mapTaskRowToTask(row);
    const project = this.dependencies.projects.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    await this.dependencies.sessions.registerTask(taskId, data, task.projectId);

    await this.dependencies.db
      .update(tasks)
      .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP`, workspaceId: data.workspaceId })
      .where(eq(tasks.id, taskId));

    // BYOI: persist the provider data (remote workspace ID, connection details) returned by
    // the provision script so it can be reused on the next session.
    if (data.workspaceProviderData) {
      await this.dependencies.db
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
    mode: Parameters<TaskSessionManager['teardownTask']>[1] = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    return this.dependencies.sessions.teardownTask(taskId, mode);
  }

  async getDeletePreflight(projectId: string, taskIds: string[]) {
    return getDeletePreflight(this.dependencies.db, this.dependencies.projects, projectId, taskIds);
  }

  async deleteTask(
    operations: OperationsEngine,
    projectId: string,
    taskId: string,
    options?: DeleteTaskOptions
  ): Promise<void> {
    await deleteTask(operations, projectId, taskId, options);
    this.notifyTaskDeleted(taskId, projectId);
  }

  notifyTaskDeleted(taskId: string, projectId: string): void {
    this._hooks.callHookBackground('task:deleted', taskId, projectId);
    taskEvents.emit(undefined, { type: 'deleted', taskId, projectId });
  }

  async deleteTasks(
    operations: OperationsEngine,
    projectId: string,
    taskIds: string[],
    options?: DeleteTaskOptions
  ): Promise<void> {
    // Notify per deletion: one failure must not suppress taskDeleted for the
    // already-removed tasks, or the renderer rollback would resurrect them.
    const results = await Promise.allSettled(
      taskIds.map(async (id) => {
        await deleteTask(operations, projectId, id, options);
        this.notifyTaskDeleted(id, projectId);
      })
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) throw failure.reason;
  }

  async archiveTask(
    projectId: string,
    taskId: string,
    telemetry: Pick<TelemetryService, 'capture'>
  ): Promise<void> {
    await archiveTask(
      this.dependencies.db,
      this.dependencies.sessions,
      projectId,
      taskId,
      telemetry
    );
    this._hooks.callHookBackground('task:archived', taskId, projectId);
  }

  async restoreTask(id: string): Promise<void> {
    const task = await restoreTask(this.dependencies.db, id);
    if (task) this._hooks.callHookBackground('task:updated', task);
  }

  async renameTask(
    projectId: string,
    taskId: string,
    newName: string
  ): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
    const result = await renameTask(this.dependencies.db, projectId, taskId, newName);
    if (result.success) this._hooks.callHookBackground('task:updated', result.data.task);
    return result;
  }

  async updateLinkedIssue(
    taskId: string,
    issue: LinkedIssue | undefined,
    telemetry: Pick<TelemetryService, 'capture'>
  ): Promise<void> {
    const task = await updateLinkedIssue(this.dependencies.db, taskId, issue, telemetry);
    if (task) this._hooks.callHookBackground('task:updated', task);
  }

  async convertAutomationTask(taskId: string): Promise<Task | null> {
    const [row] = await this.dependencies.db
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
  updateTaskStatus(
    taskId: string,
    status: Parameters<typeof updateTaskStatus>[2],
    telemetry: Pick<TelemetryService, 'capture'>
  ) {
    return updateTaskStatus(this.dependencies.db, taskId, status, telemetry);
  }
  setTaskPinned = (taskId: string, isPinned: boolean) =>
    setTaskPinned(this.dependencies.db, taskId, isPinned);
  getTasks = (projectId?: string) => getTasks(this.dependencies.db, projectId);
}

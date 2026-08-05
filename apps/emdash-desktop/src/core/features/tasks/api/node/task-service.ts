import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ConversationProvider } from '@core/features/conversations/api/node/types';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProvisionResult as SessionProvisionResult } from '@core/features/projects/api/node/project-provider';
import { buildTaskFromWorkspace } from '@core/features/tasks/api/node/task-provider-assembly';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import {
  decideWorkspaceActivation,
  didOperationSettleAfterWorkspaceUpdate,
} from '@core/features/tasks/api/node/workspace-activation-gate';
import {
  hostCreateWorktreeOperation,
  hostReprovisionWorktreeOperation,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import {
  activateWorkspaceParticipants,
  deactivateWorkspaceParticipants,
  type WorkspaceLifecycleParticipant,
} from '@core/features/workspaces/api/node/lifecycle-participants';
import { enqueueWorkspaceReprovision } from '@core/features/workspaces/api/node/operations/workspace-reprovision';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { tryAcquireWorkspaceRuntime } from '@core/features/workspaces/api/node/runtime-access';
import { deriveBranchName } from '@core/features/workspaces/api/node/workspace-branch';
import type { TaskProviderOpts } from '@core/features/workspaces/api/node/workspace-factory';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
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
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks } from '@core/services/app-db/node/schema';
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
import type { TeardownTaskError } from './task-session-manager';

type ProvisionResult = ProvisionTaskResult & { sshConnectionId?: string };
type ActivatedTask = SessionProvisionResult & {
  path: string;
  runtimeWorkspace: ReturnType<typeof hostFileRefFromNativePath>;
};

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
      workspacePlacement: WorkspacePlacementResolver;
      runtimes: RuntimeBroker;
      lifecycleParticipants: readonly WorkspaceLifecycleParticipant[];
      createConversationProvider(options: TaskProviderOpts): ConversationProvider;
      workspaceIdentity: WorkspaceIdentityService;
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
      this.dependencies.workspacePlacement,
      this.dependencies.runtimes,
      params
    );
    if (result.success) {
      this.notifyTaskCreated(result.data.task, params);
    }
    return result;
  }

  /** Fires the task:created hook. Call this after committing a task insert
   *  that was performed outside of `createTask` (e.g. inside an external transaction). */
  notifyTaskCreated(task: Task, params: CreateTaskParams): void {
    this._hooks.callHookBackground('task:created', task, params);
  }

  /**
   * Provisions the workspace for a task: ensures the path is on disk, acquires
   * the workspace (running lifecycle scripts), builds task providers, and
   * registers the task session. Idempotent — fast-paths when already provisioned.
   * Fires the `task:workspace-ready` hook on success so the workspaces wire host
   * can publish durable status to renderer replicas.
   */
  async provisionWorkspace(
    operations: OperationsEngine,
    taskId: string,
    signal?: AbortSignal,
    expectedOperationId?: string
  ): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    const [row] = await this.dependencies.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) throw new Error(`Task not found: ${taskId}`);
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

    const result = await this._activateWorkspace(operations, row, signal, expectedOperationId);
    if (!result.success) return err(result.error);

    await this._registerAndPersist(taskId, result.data);

    const provisionResult: ProvisionResult = {
      path: result.data.path,
      workspaceId: result.data.persistData.workspaceId,
      sshConnectionId: result.data.persistData.sshConnectionId,
    };

    this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
    return ok(provisionResult);
  }

  /**
   * Phases 1+2 combined: provisions workspace then session.
   * Used by the automation path which runs entirely in the main process.
   */
  async launch(
    operations: OperationsEngine,
    taskId: string
  ): Promise<Result<ProvisionResult, ProvisionWorkspaceError>> {
    return this.provisionWorkspace(operations, taskId);
  }

  private async _activateWorkspace(
    operations: OperationsEngine,
    taskRow: typeof tasks.$inferSelect,
    signal?: AbortSignal,
    expectedOperationId?: string
  ): Promise<Result<ActivatedTask, ProvisionWorkspaceError>> {
    if (!taskRow.workspaceId) return err({ type: 'missing-workspace' });
    const registry = createWorkspaceRegistry(this.dependencies.db);
    const workspaceRow = registry.getLive(taskRow.workspaceId);
    if (!workspaceRow?.path) return err({ type: 'missing-workspace' });

    let operation = expectedOperationId
      ? await operations.getForWorkspace(
          expectedOperationId,
          [hostCreateWorktreeOperation.name, hostReprovisionWorktreeOperation.name],
          workspaceRow.id
        )
      : workspaceRow.observedStatus === 'present'
        ? undefined
        : (
            await Promise.all([
              operations.latestForWorkspace(hostCreateWorktreeOperation.name, workspaceRow.id, {
                rootOnly: true,
              }),
              operations.latestForWorkspace(
                hostReprovisionWorktreeOperation.name,
                workspaceRow.id,
                { rootOnly: true }
              ),
            ])
          )
            .filter((candidate) => candidate !== undefined)
            .sort((left, right) => right.seq - left.seq)[0];
    if (expectedOperationId && !operation) {
      return err({
        type: 'setup-failed',
        stepKind: 'activation-gate',
        stepErrorType: 'operation-missing',
        message: 'The requested workspace operation was not found',
      });
    }
    if (
      workspaceRow.observedStatus === null &&
      !operation &&
      workspaceRow.config?.workspace.kind === 'new-worktree'
    ) {
      const recovered = await enqueueWorkspaceReprovision(
        operations,
        this.dependencies.projects,
        workspaceRow.id
      );
      if (!recovered.success) {
        return err({
          type: 'setup-failed',
          stepKind: 'activation-gate',
          stepErrorType: recovered.error.type,
          message: recovered.error.message,
        });
      }
      operation = recovered.data.operationId
        ? await operations.getForWorkspace(
            recovered.data.operationId,
            [hostReprovisionWorktreeOperation.name],
            workspaceRow.id
          )
        : undefined;
    }
    const workspaceObservationBoundary =
      workspaceRow.observedData?.desktopObservedAt ?? workspaceRow.updatedAt;
    const decision = decideWorkspaceActivation({
      observedStatus: workspaceRow.observedStatus,
      explicitOperation:
        expectedOperationId !== undefined ||
        (operation?.name === hostReprovisionWorktreeOperation.name &&
          didOperationSettleAfterWorkspaceUpdate(operation, workspaceObservationBoundary)),
      createOperation: operation,
    });
    if (decision.kind === 'refuse') {
      return err({
        type: 'setup-failed',
        stepKind: 'activation-gate',
        stepErrorType: decision.reason,
        message: operation?.error?.message ?? `Workspace is ${decision.reason}`,
      });
    }
    if (decision.kind === 'await-operation') {
      const settled = await operations.waitForTerminal(decision.operationId, signal);
      if (signal?.aborted) {
        return err({ type: 'cancelled', message: 'Workspace activation was cancelled' });
      }
      if (settled?.status !== 'succeeded') {
        return err({
          type: 'setup-failed',
          stepKind: 'activation-gate',
          stepErrorType: settled?.status ?? 'operation-missing',
          message: settled?.error?.message ?? 'Workspace creation did not complete',
        });
      }
    }

    const access = await tryAcquireWorkspaceRuntime(
      this.dependencies.runtimes,
      this.dependencies.workspaceIdentity,
      workspaceRow.id
    );
    if (!access.success) return access;
    if (!access.data) return err({ type: 'missing-workspace' });
    const workspacePath = parseAbsolute(workspaceRow.path);
    if (!workspacePath.success) {
      return err({
        type: 'setup-failed',
        stepKind: 'activation-gate',
        stepErrorType: 'invalid-path',
        message: workspacePath.error.message,
      });
    }
    const initialized = await access.data.client.workspaceHost.initializeWorkspace(
      {
        workspacePath: workspacePath.data,
      },
      signal ? { signal } : undefined
    );
    if (!initialized.success) {
      return err({
        type: 'setup-failed',
        stepKind: 'initialize-workspace',
        stepErrorType: initialized.error.type,
        message: initialized.error.message,
      });
    }

    const task = mapTaskRowToTask(taskRow);
    const project = this.dependencies.projects.getProject(task.projectId);
    if (!project) return err({ type: 'missing-workspace' });
    await activateWorkspaceParticipants(
      this.dependencies.lifecycleParticipants,
      access.data.identity
    );
    let built: Awaited<ReturnType<typeof buildTaskFromWorkspace>>;
    try {
      built = await buildTaskFromWorkspace(
        task,
        {
          id: workspaceRow.id,
          host: access.data.identity.host,
          path: workspaceRow.path,
          configPath: project.configPathForDirectory(workspaceRow.path),
          files: access.data.files,
          settings: project.settings,
          tuiAgents: access.data.client.tuiAgents,
        },
        project.projectId,
        project.repoPath,
        project.settings,
        this.dependencies.createConversationProvider,
        workspaceRow.config ? (deriveBranchName(workspaceRow.config.git) ?? undefined) : undefined
      );
    } catch (error) {
      await deactivateWorkspaceParticipants(
        this.dependencies.lifecycleParticipants,
        access.data.identity
      );
      throw error;
    }
    if (!built.success) {
      await deactivateWorkspaceParticipants(
        this.dependencies.lifecycleParticipants,
        access.data.identity
      );
      return built;
    }
    return ok({
      path: workspaceRow.path,
      runtimeWorkspace: hostFileRefFromNativePath(
        workspaceRow.path,
        sshConnectionIdOf(access.data.identity.host)
      ),
      taskProvider: built.data.taskProvider,
      persistData: {
        workspaceId: workspaceRow.id,
        sshConnectionId: sshConnectionIdOf(access.data.identity.host),
      },
    });
  }

  private async _registerAndPersist(taskId: string, data: ActivatedTask): Promise<void> {
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
      .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP`, workspaceId: data.persistData.workspaceId })
      .where(eq(tasks.id, taskId));
    appDbPokes.tasks.poke({ projectId: task.projectId, taskId });
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
    appDbPokes.tasks.poke({ projectId: row.projectId, taskId });
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

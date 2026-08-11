import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type { HostRuntimesClient, RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
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
  activateWorkspaceParticipants,
  deactivateWorkspaceParticipants,
  type WorkspaceLifecycleParticipant,
} from '@core/features/workspaces/api/node/lifecycle-participants';
import { operationHostRef } from '@core/features/workspaces/api/node/operation-host-ref';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import {
  createWorktreeThroughRegistry,
  type WorkspaceCreationOutcome,
  type WorkspaceCreations,
} from '@core/features/workspaces/api/node/registry-verbs';
import { tryAcquireWorkspaceRuntime } from '@core/features/workspaces/api/node/runtime-access';
import { deriveBranchName } from '@core/features/workspaces/api/node/workspace-branch';
import type { TaskProviderOpts } from '@core/features/workspaces/api/node/workspace-factory';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { HostReachabilityProbe } from '@core/primitives/ssh/api';
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
import { compileWorktreeGitPlan } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';
import { archiveTask } from '../../node/operations/archiveTask';
import { createTask } from '../../node/operations/createTask';
import {
  deleteTask,
  type DeleteTaskInput,
  type TaskDeletionDependencies,
  type TaskDeletionResult,
} from '../../node/operations/deleteTask';
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
  /** Fires after a full (non-fast-path) provision succeeds, with the wall-clock cost. */
  'task:provision-timing': (info: { taskId: string; durationMs: number }) => void | Promise<void>;
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
      creations: WorkspaceCreations;
      deletion: TaskDeletionDependencies;
      hostIsReachable: HostReachabilityProbe;
    }
  ) {}

  on<K extends keyof TaskLifecycleHooks>(name: K, handler: TaskLifecycleHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async createTask(params: CreateTaskParams): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
    const result = await createTask(
      this.dependencies.db,
      this.dependencies.projects,
      this.dependencies.hostIsReachable,
      this.dependencies.workspacePlacement,
      this.dependencies.runtimes,
      this.dependencies.creations,
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
    taskId: string,
    signal?: AbortSignal
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

    const startedAt = Date.now();
    const result = await this._activateWorkspace(row, signal);
    if (!result.success) return err(result.error);

    await this._registerAndPersist(taskId, result.data);

    const provisionResult: ProvisionResult = {
      path: result.data.path,
      workspaceId: result.data.persistData.workspaceId,
      sshConnectionId: result.data.persistData.sshConnectionId,
    };

    this._hooks.callHookBackground('task:provision-timing', {
      taskId,
      durationMs: Date.now() - startedAt,
    });
    this._hooks.callHookBackground('task:workspace-ready', taskId, provisionResult);
    return ok(provisionResult);
  }

  private async _activateWorkspace(
    taskRow: typeof tasks.$inferSelect,
    signal?: AbortSignal
  ): Promise<Result<ActivatedTask, ProvisionWorkspaceError>> {
    if (!taskRow.workspaceId) return err({ type: 'missing-workspace' });
    const registry = createWorkspaceRegistry(this.dependencies.db);
    const workspaceRow = registry.getLive(taskRow.workspaceId);
    if (!workspaceRow?.path) return err({ type: 'missing-workspace' });

    // Creation gate (ADR 0005): a creation still in flight is awaited; a durably
    // failed creation — or a provenance worktree whose artifact is not observed
    // present — is replayed through the registry verb with the identical stored spec.
    const pendingCreation = this.dependencies.creations.pending(workspaceRow.id);
    const needsReplay =
      (workspaceRow.lastCreateOutcome && workspaceRow.lastCreateOutcome.status !== 'succeeded') ||
      (workspaceRow.observedStatus !== 'present' &&
        workspaceRow.config?.workspace.kind === 'new-worktree');
    if (pendingCreation) {
      const outcome = await pendingCreation;
      if (signal?.aborted) {
        return err({ type: 'cancelled', message: 'Workspace activation was cancelled' });
      }
      if (!outcome.success) {
        return err({
          type: 'setup-failed',
          stepKind: 'activation-gate',
          stepErrorType: outcome.error.stage,
          message: outcome.error.message,
        });
      }
    } else if (needsReplay) {
      const replayed = await this.replayWorktreeCreation(workspaceRow);
      if (signal?.aborted) {
        return err({ type: 'cancelled', message: 'Workspace activation was cancelled' });
      }
      if (!replayed.success) {
        return err({
          type: 'setup-failed',
          stepKind: 'activation-gate',
          stepErrorType: replayed.error.stage,
          message: replayed.error.message,
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
    const activated = await this.activateOnRegistry(
      access.data.client.workspaceRegistry,
      workspaceRow.id,
      workspaceRow.path
    );
    if (!activated.success) return activated;
    if (signal?.aborted) {
      return err({ type: 'cancelled', message: 'Workspace activation was cancelled' });
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
          hostSettings: access.data.client.hostSettings,
        },
        project.projectId,
        project.repoPath,
        project.settings,
        project.repoFacts,
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

  /**
   * Activates the workspace on the host registry (prepare gates the return; setup and
   * run stream through the records live model). A record the registry has never seen —
   * repository instances and pre-registry rows — is registered first, then activated.
   */
  private async activateOnRegistry(
    registry: Pick<
      HostRuntimesClient['workspaceRegistry'],
      'activateWorkspace' | 'createWorkspace'
    >,
    workspaceId: string,
    workspacePath: string,
    retried = false
  ): Promise<Result<void, ProvisionWorkspaceError>> {
    const activated = await registry.activateWorkspace({ workspaceId });
    if (activated.success) return ok(undefined);
    if (activated.error.type === 'workspace-missing') {
      return err({ type: 'missing-workspace' });
    }
    if (activated.error.type === 'workspace-not-found' && !retried) {
      const registered = await registry.createWorkspace({ workspaceId, path: workspacePath });
      if (registered.success || registered.error.type === 'already-registered') {
        return this.activateOnRegistry(registry, workspaceId, workspacePath, true);
      }
      return err({
        type: 'setup-failed',
        stepKind: 'activation-gate',
        stepErrorType: registered.error.type,
        message: `Could not register the workspace on the host (${registered.error.type})`,
      });
    }
    return err({
      type: 'setup-failed',
      stepKind: 'activate-workspace',
      stepErrorType: activated.error.type,
      message: 'Workspace activation failed on the host',
    });
  }

  /**
   * Replays a durably failed worktree creation through the registry verb with the
   * identical spec recompiled from stored provenance (idempotent per ADR 0005).
   */
  private async replayWorktreeCreation(
    workspaceRow: WorkspaceRow
  ): Promise<WorkspaceCreationOutcome> {
    const config = workspaceRow.config;
    if (!config || !workspaceRow.path || workspaceRow.kind !== 'worktree') {
      return err({ stage: 'replay', message: 'Workspace provenance is incomplete.' });
    }
    const [task] = await this.dependencies.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceRow.id), isNull(tasks.deletedAt)))
      .limit(1);
    const project = task ? this.dependencies.projects.getProject(task.projectId) : undefined;
    if (!project) {
      return err({ stage: 'replay', message: 'Workspace project was not found.' });
    }
    if (config.git.kind === 'none') {
      return err({
        stage: 'replay',
        message: 'A Git branch is required when creating a worktree.',
      });
    }
    const baseRemote = await project.gitRepository.getBaseRemote();
    if (baseRemote === null && config.git.kind === 'pr-branch') {
      return err({
        stage: 'replay',
        message: 'The repository has no git remotes, so a pull request cannot be checked out.',
      });
    }
    const gitPlan = compileWorktreeGitPlan(config.git, { baseRemote });
    const settings = await project.settings.get();
    const workspacePath = workspaceRow.path;
    return this.dependencies.creations.run(workspaceRow.id, () =>
      createWorktreeThroughRegistry(this.dependencies.runtimes, {
        host: project.host,
        repositoryWorkspaceId: workspaceRow.parentId,
        repositoryPath: project.repoPath,
        workspaceId: workspaceRow.id,
        branch: gitPlan.branch,
        ...(gitPlan.baseRef !== undefined && { baseRef: gitPlan.baseRef }),
        path: workspacePath,
        preservePatterns: settings.preservePatterns ?? [],
        pushBranch: gitPlan.pushBranch,
        ...(gitPlan.gitSetup !== undefined && { gitSetup: gitPlan.gitSetup }),
      })
    );
  }

  /**
   * User-requested reprovision: optionally force-removes the current artifact through
   * `deleteWorktree` (sessions killed, teardown run, record unregistered), then replays
   * the creation with the identical stored spec. The mirror row survives throughout —
   * it is the durable intent the replay recompiles from.
   */
  async reprovisionWorkspace(
    workspaceId: string,
    options: { removeFirst?: boolean } = {}
  ): Promise<Result<Record<string, never>, { type: string; message: string }>> {
    const workspaceRow = createWorkspaceRegistry(this.dependencies.db).getLive(workspaceId);
    if (!workspaceRow?.path || workspaceRow.kind !== 'worktree' || !workspaceRow.config) {
      return err({
        type: 'workspace-not-reprovisionable',
        message: 'Workspace provenance is incomplete.',
      });
    }
    if (options.removeFirst) {
      const host = operationHostRef({ workspace: workspaceRow });
      const client = await this.dependencies.runtimes.client(host);
      if (!client.success) {
        return err({ type: 'host-unreachable', message: client.error.message });
      }
      const removed = await client.data.workspaceRegistry.deleteWorktree({
        workspaceId,
        deleteBranch: false,
      });
      if (!removed.success) {
        return err({ type: 'delete-failed', message: `Removal failed (${removed.error.type}).` });
      }
    }
    const replayed = await this.replayWorktreeCreation(workspaceRow);
    if (!replayed.success) {
      return err({ type: replayed.error.stage, message: replayed.error.message });
    }
    appDbPokes.workspaces.poke({});
    return ok({});
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

  async getDeletePreflight(taskIds: string[]) {
    return getDeletePreflight(this.dependencies.db, this.dependencies.hostIsReachable, taskIds);
  }

  /**
   * The wire `delete` mutation's entry point: the plain task deletion (no kernel
   * submit), surfacing the Result unchanged so duplicate/absence stays non-throwing.
   */
  async delete(input: DeleteTaskInput): Promise<TaskDeletionResult> {
    const [row] = await this.dependencies.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);
    const result = await deleteTask(this.dependencies.deletion, input);
    if (result.success && row) this.notifyTaskDeleted(input.taskId, row.projectId);
    return result;
  }

  async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions): Promise<void> {
    const result = await deleteTask(this.dependencies.deletion, {
      taskId,
      deleteWorktree: options?.deleteWorktree,
      deleteBranch: options?.deleteBranch,
      deleteConversations: options?.deleteConversations,
    });
    if (!result.success && result.error.type !== 'task-not-found') {
      throw new Error(result.error.message);
    }
    this.notifyTaskDeleted(taskId, projectId);
  }

  notifyTaskDeleted(taskId: string, projectId: string): void {
    this._hooks.callHookBackground('task:deleted', taskId, projectId);
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

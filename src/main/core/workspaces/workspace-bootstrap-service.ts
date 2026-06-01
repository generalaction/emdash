import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider, TaskProvider } from '@main/core/projects/project-provider';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { buildTaskFromWorkspace, emitTaskProvisionProgress } from '@main/core/tasks/task-builder';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db as appDb, type AppDb } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@shared/result';
import type { Task } from '@shared/tasks';
import { compileSetupSpec } from '@shared/workspace-setup-spec';
import type { WorkspaceType } from '@shared/workspaces';
import { resolveWorkspaceIntent } from '../tasks/resolve-workspace-intent';
import { provisionBYOITask } from './byoi/provision-byoi-task';
import { LocalWorkspaceSetupExecutor } from './local-workspace-setup-executor';
import { applyRecovery } from './recovery-strategy';
import { createWorkspaceFactory } from './workspace-factory';
import { computeWorkspaceKey } from './workspace-key';
import { workspaceRegistry } from './workspace-registry';

export type ProvisionWorkspaceError =
  | { type: 'no-intent' }
  | { type: 'setup-failed'; stepKind: string; stepErrorType: string; message?: string };

export function formatProvisionWorkspaceError(error: ProvisionWorkspaceError): string {
  switch (error.type) {
    case 'no-intent':
      return 'Workspace has no intent and no resolved path — cannot provision.';
    case 'setup-failed':
      return `Setup step '${error.stepKind}' failed (${error.stepErrorType})${error.message ? `: ${error.message}` : ''}.`;
  }
}

export type WorkspaceBootstrapResult = {
  path: string;
  workspaceId: string;
  sshConnectionId?: string;
  worktreeGitDir?: string;
  taskProvider: TaskProvider;
  /** BYOI only — workspace provider data to persist in the DB. */
  workspaceProviderData?: unknown;
};

export class WorkspaceBootstrapService {
  constructor(private readonly db: AppDb) {}

  /**
   * Ensures the workspace for a task is fully set up on disk, acquires the
   * workspace (running lifecycle scripts), and builds task providers.
   *
   * - **Fast path (idempotent)**: if `workspaceRow.path` is set and the directory
   *   exists on disk, skips git setup and goes straight to workspace acquisition.
   * - **BYOI workspaces**: delegates to `provisionBYOITask` which runs the
   *   provision script, connects SSH, and acquires the workspace.
   * - **Local/SSH workspaces**: compiles and executes the `WorkspaceSetupSpec`,
   *   applies recovery on failure, persists the resolved path, then acquires.
   * - **SSH channel recovery**: calls `reportChannelRecovered` after a successful
   *   setup on an SSH project.
   */
  async ensureWorkspaceSetup(
    workspaceRow: {
      id: string;
      type: WorkspaceType;
      path: string | null;
      workspaceProvider?: string | null;
      data?: string | null;
    },
    taskRow: {
      workspaceIntent: string | null;
      taskBranch: string | null;
      sourceBranch: unknown;
      workspaceProvider: string | null;
    },
    task: Task,
    project: ProjectProvider
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    // Fast path: path already persisted and still exists on disk.
    if (workspaceRow.path && workspaceRow.type !== 'byoi') {
      const exists = await project.worktreeHost.existsAbsolute(workspaceRow.path);
      if (exists) {
        return this._acquireAndBuild(workspaceRow.id, task, project, workspaceRow.path);
      }
    }

    // BYOI workspaces are managed by provisionBYOITask.
    if (workspaceRow.type === 'byoi') {
      return this._provisionBYOI(workspaceRow, task, project);
    }

    const intent = resolveWorkspaceIntent(taskRow, workspaceRow);
    if (!intent) {
      return err({ type: 'no-intent' });
    }

    const connectionId =
      project.defaultWorkspaceType.kind === 'ssh'
        ? project.defaultWorkspaceType.connectionId
        : undefined;

    const { baseRemote, pushRemote } = await project.repository.getConfiguredRemotes();
    const spec = compileSetupSpec(intent.git, intent.workspace, { baseRemote, pushRemote });

    if (spec.length === 0) {
      // No git operations needed — use existing project root or provided path.
      const resolvedPath =
        'path' in intent.workspace && intent.workspace.path
          ? intent.workspace.path
          : project.repoPath;
      await this.persistPath(workspaceRow.id, resolvedPath, workspaceRow.type, connectionId);
      return this._acquireAndBuild(workspaceRow.id, task, project, resolvedPath);
    }

    const worktreePoolPath = await project.worktreeService.getWorktreePoolPath();
    const stepCtx = {
      ctx: project.ctx,
      repoPath: project.repoPath,
      worktreePoolPath,
      host: project.worktreeHost,
      projectSettings: project.settings,
    };

    const executor = new LocalWorkspaceSetupExecutor(stepCtx);
    let setupResult = await executor.execute(spec);

    if (!setupResult.success) {
      const recovery = await applyRecovery(setupResult.error, stepCtx);

      if (recovery.kind === 'resolved') {
        setupResult = ok({ path: recovery.path, warnings: [] });
      } else if (recovery.kind === 'retry') {
        setupResult = await executor.execute(spec);
      }
      // 'failed' falls through to the error check below
    }

    if (!setupResult.success) {
      const { kind, type } = setupResult.error;
      const message = 'message' in setupResult.error ? setupResult.error.message : undefined;
      return err({ type: 'setup-failed', stepKind: kind, stepErrorType: type, message });
    }

    const resolvedPath = setupResult.data.path;
    if (resolvedPath) {
      await this.persistPath(workspaceRow.id, resolvedPath, workspaceRow.type, connectionId);
    }

    if (connectionId) {
      sshConnectionManager.reportChannelRecovered(connectionId);
    }

    return this._acquireAndBuild(workspaceRow.id, task, project, resolvedPath ?? '');
  }

  /**
   * Public entry point for the RPC controller.
   * Loads the workspace + task rows from DB, resolves the project,
   * and delegates to `ensureWorkspaceSetup`.
   */
  async ensureWorkspaceSetupForTask(
    taskId: string
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row?.workspaceId) throw new Error(`Task ${taskId} has no workspaceId`);

    const [wsRow] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId))
      .limit(1);
    if (!wsRow) throw new Error(`Workspace ${row.workspaceId} not found for task ${taskId}`);

    const project = projectManager.getProject(row.projectId);
    if (!project) throw new Error(`Project ${row.projectId} not found`);

    const task = mapTaskRowToTask(row);
    return this.ensureWorkspaceSetup(wsRow, row, task, project);
  }

  /**
   * Persists a resolved path (and its derived key) onto a workspace row.
   *
   * If another workspace already owns that path (same key), its ID is returned
   * so the caller can re-point any tasks. Returns the original workspaceId when
   * the update succeeds normally.
   *
   * @internal Exposed for unit testing; prefer `ensureWorkspaceSetup` in application code.
   */
  async persistPath(
    workspaceId: string,
    path: string,
    type: WorkspaceType,
    connectionId?: string
  ): Promise<string> {
    const key = type !== 'byoi' ? computeWorkspaceKey(type, path, connectionId) : null;

    if (key) {
      const [existing] = await this.db.select().from(workspaces).where(eq(workspaces.key, key));
      if (existing && existing.id !== workspaceId) {
        return existing.id;
      }
    }

    await this.db
      .update(workspaces)
      .set({ path, key, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workspaces.id, workspaceId));
    return workspaceId;
  }

  /**
   * Acquires the workspace via the registry (runs lifecycle scripts on first
   * acquire) then builds task providers. Returns a `WorkspaceBootstrapResult`.
   */
  private async _acquireAndBuild(
    workspaceId: string,
    task: Task,
    project: ProjectProvider,
    workDir: string
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const type = project.defaultWorkspaceType;

    emitTaskProvisionProgress({
      taskId: task.id,
      projectId: project.projectId,
      step: 'initialising-workspace',
      message: 'Initialising workspace…',
    });

    let workspace;
    try {
      workspace = await workspaceRegistry.acquire(
        workspaceId,
        project.projectId,
        createWorkspaceFactory(workspaceId, type, {
          task,
          workDir,
          projectId: project.projectId,
          projectPath: project.repoPath,
          settings: project.settings,
          logPrefix: 'WorkspaceBootstrapService',
          repository: project.repository,
          fetchService: project.gitFetchService,
        })
      );
    } catch (e) {
      return err({
        type: 'setup-failed',
        stepKind: 'workspace-acquire',
        stepErrorType: 'error',
        message: String(e),
      });
    }

    // Compute worktreeGitDir for local workspaces (used by git watcher registry).
    let worktreeGitDir: string | undefined;
    if (type.kind === 'local') {
      try {
        const mainDotGitAbs = path.resolve(project.repoPath, '.git');
        worktreeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
      } catch (e) {
        log.warn('WorkspaceBootstrapService: failed to resolve worktreeGitDir', {
          workspaceId,
          error: String(e),
        });
      }
    }

    emitTaskProvisionProgress({
      taskId: task.id,
      projectId: project.projectId,
      step: 'starting-sessions',
      message: 'Preparing task…',
    });

    let buildSucceeded = false;
    try {
      const buildResult = await buildTaskFromWorkspace(
        task,
        workspace,
        type,
        project.projectId,
        project.repoPath,
        project.settings
      );
      buildSucceeded = true;
      return ok({
        path: workDir,
        workspaceId,
        sshConnectionId: type.kind === 'ssh' ? type.connectionId : undefined,
        worktreeGitDir,
        taskProvider: buildResult.taskProvider,
      });
    } catch (e) {
      return err({
        type: 'setup-failed',
        stepKind: 'build-providers',
        stepErrorType: 'error',
        message: String(e),
      });
    } finally {
      if (!buildSucceeded) {
        await workspaceRegistry.release(workspaceId, 'terminate').catch(() => {});
      }
    }
  }

  /**
   * Provisions a BYOI workspace by delegating to `provisionBYOITask`.
   */
  private async _provisionBYOI(
    workspaceRow: { id: string; workspaceProvider?: string | null; data?: string | null },
    task: Task,
    project: ProjectProvider
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const projectSettings = await project.settings.get();
    if (projectSettings.workspaceProvider?.type !== 'script') {
      return err({
        type: 'setup-failed',
        stepKind: 'byoi-config',
        stepErrorType: 'missing-provider',
        message: 'Task has workspaceProvider=byoi but project has no script provider configured',
      });
    }

    try {
      const result = await provisionBYOITask({
        task,
        wpConfig: projectSettings.workspaceProvider,
        ctx: project.ctx,
        projectId: project.projectId,
        projectPath: project.repoPath,
        settings: project.settings,
        logPrefix: `${project.type}ProjectProvider[byoi]`,
        workspaceId: workspaceRow.id,
      });
      return ok(result);
    } catch (e) {
      return err({
        type: 'setup-failed',
        stepKind: 'byoi-provision',
        stepErrorType: 'error',
        message: String(e),
      });
    }
  }
}

export const workspaceBootstrapService = new WorkspaceBootstrapService(appDb);

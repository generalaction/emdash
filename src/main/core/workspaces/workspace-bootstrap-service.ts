import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db as appDb, type AppDb } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { err, ok, type Result } from '@shared/result';
import { compileSetupSpec } from '@shared/workspace-setup-spec';
import type { WorkspaceType } from '@shared/workspaces';
import { resolveWorkspaceIntent } from '../tasks/resolve-workspace-intent';
import { LocalWorkspaceSetupExecutor } from './local-workspace-setup-executor';
import { applyRecovery } from './recovery-strategy';
import { computeWorkspaceKey } from './workspace-key';

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

export class WorkspaceBootstrapService {
  constructor(private readonly db: AppDb) {}

  /**
   * Ensures the workspace for a task is fully set up on disk.
   *
   * - **Fast path (idempotent)**: if `workspaceRow.path` is set and the directory
   *   exists on disk, returns immediately.
   * - **BYOI workspaces**: return early — their path is managed by the BYOI provision
   *   flow (`provisionBYOITask`) which runs during task session setup.
   * - **Local/SSH workspaces**: compiles and executes the `WorkspaceSetupSpec`,
   *   applies recovery on failure, and persists the resolved path.
   * - **SSH channel recovery**: calls `reportChannelRecovered` after a successful
   *   setup on an SSH project.
   */
  async ensureWorkspaceSetup(
    workspaceRow: {
      id: string;
      type: WorkspaceType;
      path: string | null;
    },
    taskRow: {
      workspaceIntent: string | null;
      taskBranch: string | null;
      sourceBranch: unknown;
      workspaceProvider: string | null;
    },
    project: ProjectProvider
  ): Promise<Result<string, ProvisionWorkspaceError>> {
    // Fast path: path already persisted and still exists on disk.
    if (workspaceRow.path) {
      const exists = await project.worktreeHost.existsAbsolute(workspaceRow.path);
      if (exists) return ok(workspaceRow.path);
    }

    // BYOI workspaces are managed by provisionBYOITask during session provisioning.
    if (workspaceRow.type === 'byoi') {
      return ok(workspaceRow.path ?? '');
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
      const path =
        'path' in intent.workspace && intent.workspace.path
          ? intent.workspace.path
          : project.repoPath;
      await this.persistPath(workspaceRow.id, path, workspaceRow.type, connectionId);
      return ok(path);
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

    return ok(resolvedPath ?? '');
  }

  /**
   * Public entry point for the RPC controller.
   * Loads the workspace + task rows from DB, resolves the project,
   * and delegates to `ensureWorkspaceSetup`.
   */
  async ensureWorkspaceSetupForTask(
    taskId: string
  ): Promise<Result<string, ProvisionWorkspaceError>> {
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

    return this.ensureWorkspaceSetup(wsRow, row, project);
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
}

export const workspaceBootstrapService = new WorkspaceBootstrapService(appDb);

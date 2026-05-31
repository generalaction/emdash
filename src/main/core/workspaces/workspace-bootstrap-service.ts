import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db as appDb, type AppDb } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import type { WorkspaceResolution, WorkspaceType } from '@shared/workspaces';
import type { WorktreeBootstrapOps } from '../projects/worktrees/worktree-service';
import { mapWorktreeErrorToProvisionError } from '../tasks/provision-task-error';
import { fromStoredBranch } from '../tasks/stored-branch';
import { computeWorkspaceKey } from './workspace-key';

export type WorktreeContext = {
  /** undefined for local projects, set for SSH */
  connectionId?: string;
  /** Absolute path to the project repo root — used when a task has no taskBranch */
  repoPath: string;
  worktreeService: WorktreeBootstrapOps;
};

export class WorkspaceBootstrapService {
  constructor(private readonly db: AppDb) {}

  /**
   * Resolves the bootstrap state for a task's workspace.
   * Handles legacy workspace ID migration, path existence checks, and branch discovery.
   */
  async resolveBootstrap(taskId: string, ctx: WorktreeContext): Promise<WorkspaceResolution> {
    const [taskRow] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!taskRow) throw new Error(`Task not found: ${taskId}`);

    const rawWorkspaceId = taskRow.workspaceId;
    let workspaceId: string;

    if (!rawWorkspaceId || this._isLegacyWorkspaceId(rawWorkspaceId)) {
      workspaceId = await this._migrateLegacyWorkspaceId(taskId, taskRow, rawWorkspaceId, ctx);
    } else {
      workspaceId = rawWorkspaceId;
    }

    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    if (workspace.type === 'byoi') {
      return { kind: 'ready' };
    }

    const taskBranch = taskRow.taskBranch ?? null;
    const { worktreeService } = ctx;

    if (workspace.path) {
      const pathExists = await worktreeService.existsAtAbsolutePath(workspace.path);
      if (pathExists) {
        return { kind: 'ready' };
      }

      if (!taskBranch) {
        return { kind: 'path_missing', previousPath: workspace.path, taskBranch: null };
      }

      const candidatePath = await worktreeService.findBranchAnywhere(taskBranch);
      if (candidatePath && candidatePath !== workspace.path) {
        return {
          kind: 'branch_elsewhere',
          taskBranch,
          candidatePath,
          previousPath: workspace.path,
        };
      }

      return { kind: 'path_missing', previousPath: workspace.path, taskBranch };
    }

    if (!taskBranch) {
      return { kind: 'needs_create' };
    }

    const candidatePath = await worktreeService.findBranchAnywhere(taskBranch);
    if (candidatePath) {
      await this._persistPathForTask(
        workspace.id,
        taskId,
        candidatePath,
        workspace.type,
        ctx.connectionId
      );
      return { kind: 'ready' };
    }

    return { kind: 'needs_create' };
  }

  /**
   * Creates a worktree for a task and persists the resolved path.
   * Falls back to repoPath when the task has no taskBranch.
   */
  async createWorktreeForTask(taskId: string, ctx: WorktreeContext): Promise<void> {
    const [taskRow] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!taskRow?.workspaceId) throw new Error(`Task or workspace not found: ${taskId}`);

    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, taskRow.workspaceId));
    if (!workspace) throw new Error(`Workspace not found: ${taskRow.workspaceId}`);

    let worktreePath: string;

    if (!taskRow.taskBranch) {
      worktreePath = ctx.repoPath;
    } else {
      const sourceBranch = fromStoredBranch(taskRow.sourceBranch);
      if (!sourceBranch || taskRow.taskBranch === sourceBranch.branch) {
        const result = await ctx.worktreeService.checkoutExistingBranch(taskRow.taskBranch);
        if (!result.success)
          throw mapWorktreeErrorToProvisionError(taskRow.taskBranch, result.error);
        worktreePath = result.data;
      } else {
        const result = await ctx.worktreeService.checkoutBranchWorktree(
          sourceBranch,
          taskRow.taskBranch
        );
        if (!result.success)
          throw mapWorktreeErrorToProvisionError(taskRow.taskBranch, result.error);
        worktreePath = result.data;
      }
    }

    await this._persistPathForTask(
      workspace.id,
      taskId,
      worktreePath,
      workspace.type,
      ctx.connectionId
    );
  }

  /**
   * Adopts an existing path as the workspace location for a task.
   */
  async adoptPath(taskId: string, candidatePath: string, ctx: WorktreeContext): Promise<void> {
    const [taskRow] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!taskRow?.workspaceId) throw new Error(`Task or workspace not found: ${taskId}`);

    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, taskRow.workspaceId));
    if (!workspace) throw new Error(`Workspace not found: ${taskRow.workspaceId}`);

    await this._persistPathForTask(
      workspace.id,
      taskId,
      candidatePath,
      workspace.type,
      ctx.connectionId
    );
  }

  /**
   * Persists a resolved path (and its derived key) onto a workspace row.
   *
   * If another workspace already owns that path (same key), its ID is returned
   * so the caller can re-point any tasks. Returns the original workspaceId when
   * the update succeeds normally.
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _persistPathForTask(
    workspaceId: string,
    taskId: string,
    path: string,
    type: WorkspaceType,
    connectionId?: string
  ): Promise<void> {
    const resolvedId = await this.persistPath(workspaceId, path, type, connectionId);
    if (resolvedId !== workspaceId) {
      // Key conflict: re-point the task to the workspace that already owns this path.
      await this.db.update(tasks).set({ workspaceId: resolvedId }).where(eq(tasks.id, taskId));
    }
  }

  private _isLegacyWorkspaceId(id: string): boolean {
    return id.startsWith('local:') || id.startsWith('ssh:') || id.startsWith('remote:');
  }

  private async _migrateLegacyWorkspaceId(
    taskId: string,
    taskRow: { workspaceProvider?: string | null; workspaceId?: string | null },
    rawWorkspaceId: string | null | undefined,
    ctx: WorktreeContext
  ): Promise<string> {
    const newId = crypto.randomUUID();
    const workspaceType = this._resolveWorkspaceType(
      rawWorkspaceId,
      taskRow.workspaceProvider,
      ctx
    );

    this.db.transaction((tx) => {
      tx.insert(workspaces).values({ id: newId, type: workspaceType }).run();
      tx.update(tasks).set({ workspaceId: newId }).where(eq(tasks.id, taskId)).run();
    });

    return newId;
  }

  private _resolveWorkspaceType(
    rawWorkspaceId: string | null | undefined,
    workspaceProvider: string | null | undefined,
    ctx: WorktreeContext
  ): WorkspaceType {
    if (rawWorkspaceId?.startsWith('remote:') || workspaceProvider === 'byoi') return 'byoi';
    if (rawWorkspaceId?.startsWith('ssh:') || ctx.connectionId !== undefined) return 'project-ssh';
    return 'local';
  }
}

export const workspaceBootstrapService = new WorkspaceBootstrapService(appDb);

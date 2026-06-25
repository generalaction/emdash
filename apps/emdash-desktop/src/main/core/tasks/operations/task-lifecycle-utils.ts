import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { resolveWorkspaceKind } from '@main/core/workspaces/resolve-workspace-kind';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { WorkspaceKind, WorkspaceType } from '@shared/core/workspaces/workspaces';
import type { ProjectProvider } from '../../projects/project-provider';

const execFileAsync = promisify(execFile);

export type LocalWorkspaceCleanupTarget = {
  id?: string;
  kind?: WorkspaceKind | null;
  type?: WorkspaceType | null;
  location?: 'local' | 'remote' | null;
  path?: string | null;
};

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isLocalWorkspace(workspace: LocalWorkspaceCleanupTarget): boolean {
  if (workspace.location === 'remote') return false;
  if (workspace.type === 'project-ssh' || workspace.type === 'byoi') return false;
  return true;
}

export async function hasWorktreeGitMarker(workspacePath: string | null | undefined) {
  return workspacePath ? pathExists(path.join(workspacePath, '.git')) : false;
}

function isWorktreeWorkspace(workspace: LocalWorkspaceCleanupTarget): boolean {
  if (!workspace.type) return workspace.kind === 'worktree';
  return (
    resolveWorkspaceKind({
      kind: workspace.kind,
      type: workspace.type,
      path: workspace.path,
    }) === 'worktree'
  );
}

async function workspaceHasRemainingTasks(
  workspaceId: string,
  excludeArchived: boolean
): Promise<boolean> {
  const where = excludeArchived
    ? and(eq(tasks.workspaceId, workspaceId), isNull(tasks.archivedAt))
    : eq(tasks.workspaceId, workspaceId);

  const siblings = await db.select({ id: tasks.id }).from(tasks).where(where).limit(1);
  return siblings.length > 0;
}

async function pruneGitWorktrees(projectPath: string): Promise<void> {
  try {
    await execFileAsync('git', ['-C', projectPath, 'worktree', 'prune'], { timeout: 5_000 });
  } catch (error) {
    log.warn('git worktree prune failed after task worktree cleanup', {
      projectPath,
      error: String(error),
    });
  }
}

export async function removeOwnedLocalWorktreeDirectory(
  workspace: LocalWorkspaceCleanupTarget,
  projectPath: string
): Promise<boolean> {
  if (!workspace.path || !isLocalWorkspace(workspace)) return false;

  const workspacePath = path.resolve(workspace.path);
  const projectRootPath = path.resolve(projectPath);
  if (workspacePath === projectRootPath) {
    if (workspace.kind === 'worktree') {
      throw new Error(`Refusing to remove project root path "${workspace.path}"`);
    }
    return false;
  }

  if (!isWorktreeWorkspace(workspace)) return false;

  await fs.rm(workspacePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });

  if (await pathExists(workspacePath)) {
    throw new Error(`Failed to remove worktree directory "${workspace.path}"`);
  }

  await pruneGitWorktrees(projectPath);
  return true;
}

export async function removeOwnedLocalWorktreeDirectoryIfUnused(
  workspace: LocalWorkspaceCleanupTarget & { id: string },
  projectPath: string,
  excludeArchived: boolean
): Promise<boolean> {
  if (await workspaceHasRemainingTasks(workspace.id, excludeArchived)) return false;
  return removeOwnedLocalWorktreeDirectory(workspace, projectPath);
}

/**
 * Removes the worktree for destructive task deletion when no remaining sibling task shares the
 * same workspace.
 *
 * `excludeArchived = false` means any remaining sibling blocks removal. Archive intentionally
 * preserves workspace assets and does not call this helper.
 *
 * Returns `true` if the worktree was removed (no siblings found), `false` otherwise.
 */
export async function removeWorktreeIfUnused(
  workspace: {
    id: string;
    kind: 'worktree' | 'project-root' | 'byoi' | null;
    branchName: string | null;
    config: WorkspaceConfig | null;
  },
  project: ProjectProvider,
  excludeArchived: boolean
): Promise<boolean> {
  const branchName = getProvisionedWorkspaceBranch(workspace);
  if (!branchName) return false;

  if (await workspaceHasRemainingTasks(workspace.id, excludeArchived)) return false;

  try {
    await project.removeTaskWorktree(branchName);
  } catch (e) {
    log.warn('removeWorktreeIfUnused: worktree removal failed', {
      branchName,
      error: String(e),
    });
    return false;
  }
  return true;
}

/**
 * Deletes the workspace row and its derived file index only when no other task still references it.
 *
 * Tasks are deduplicated onto a single workspace row per resolved path (see
 * `WorkspaceBootstrapService.persistPath`), so for `no-worktree` tasks every task in a
 * project shares the project-root workspace. Deleting it unconditionally orphaned the
 * siblings, whose `workspaceId` then pointed at a missing row — surfacing later as
 * `Workspace not found` during bootstrap. `excludeTaskId` is the task being deleted; its
 * row still exists at this point, so it must not count as a reference.
 */
export async function deleteWorkspaceIfUnused(
  workspaceId: string,
  excludeTaskId: string
): Promise<void> {
  const [wsRow] = await db
    .select({ id: workspaces.id, kind: workspaces.kind })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  // project-root workspaces outlive any individual task — never delete them.
  if (wsRow?.kind === 'project-root') return;

  const [sibling] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), ne(tasks.id, excludeTaskId)))
    .limit(1);
  if (sibling) return;

  try {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    workspaceFileIndexService.deleteIndex(workspaceId);
  } catch (e) {
    log.warn('deleteWorkspaceIfUnused: workspace row deletion failed', {
      workspaceId,
      error: String(e),
    });
  }
}

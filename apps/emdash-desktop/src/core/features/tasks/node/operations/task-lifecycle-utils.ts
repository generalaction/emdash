import path from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { resolveWorkspaceKind } from '@core/features/workspaces/api/node/resolve-workspace-kind';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { WorkspaceKind, WorkspaceType } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import type { FilesRuntimeClient } from '@core/services/runtime-broker/api/clients';
import {
  fileKey,
  fileMutationKey,
  filesClientScope,
  fsErrorMessage,
  isFileNotFoundError,
} from '@core/services/runtime-broker/node/files';
import { mutationResult, repositorySelector } from '@core/services/runtime-broker/node/git';

export type LocalWorkspaceCleanupTarget = {
  id?: string;
  kind?: WorkspaceKind | null;
  type?: WorkspaceType | null;
  location?: 'local' | 'remote' | null;
  path?: string | null;
};

export type TaskLifecycleDependencies = {
  db: AppDb;
  getFilesRuntimeClient(): Promise<FilesRuntimeClient>;
  runtimes: Pick<RuntimeBroker, 'client'>;
  unregisterFileSearchRoot(path: HostAbsolutePath): Promise<void> | void;
};

export async function pathExists(
  dependencies: Pick<TaskLifecycleDependencies, 'getFilesRuntimeClient'>,
  filePath: string
): Promise<boolean> {
  const client = await dependencies.getFilesRuntimeClient();
  const files = filesClientScope(client, path.dirname(filePath));
  const exists = await client.fs.exists(fileKey(files, filePath));
  return exists.success && exists.data;
}

export function isLocalWorkspace(workspace: LocalWorkspaceCleanupTarget): boolean {
  if (workspace.location === 'remote') return false;
  if (workspace.type === 'project-ssh' || workspace.type === 'byoi') return false;
  return true;
}

export async function hasWorktreeGitMarker(
  dependencies: Pick<TaskLifecycleDependencies, 'getFilesRuntimeClient'>,
  workspacePath: string | null | undefined
) {
  return workspacePath ? pathExists(dependencies, path.join(workspacePath, '.git')) : false;
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
  db: AppDb,
  workspaceId: string,
  excludeArchived: boolean
): Promise<boolean> {
  const where = excludeArchived
    ? and(eq(tasks.workspaceId, workspaceId), isNull(tasks.archivedAt), isNull(tasks.deletedAt))
    : and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt));

  const siblings = await db.select({ id: tasks.id }).from(tasks).where(where).limit(1);
  return siblings.length > 0;
}

async function pruneGitWorktrees(
  dependencies: Pick<TaskLifecycleDependencies, 'runtimes'>,
  projectPath: string
): Promise<void> {
  try {
    const runtime = await dependencies.runtimes.client(LOCAL_HOST_REF);
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    const result = await mutationResult(
      runtime.data.git.repository.model.mutate('pruneWorktrees', {
        key: repositorySelector(projectPath),
        input: {},
      })
    );
    if (!result.success) throw new Error(String(result.error));
  } catch (error) {
    log.warn('git worktree prune failed after task worktree cleanup', {
      projectPath,
      error: String(error),
    });
  }
}

export type OwnedWorktreeCleanupError =
  | { type: 'project-root-refused'; path: string; message: string }
  | { type: 'removal-failed'; path: string; message: string };

/**
 * Removes the recorded worktree directory of a local workspace. Fallback for
 * task deletion when the project provider is unavailable or its git-based
 * removal did not apply.
 *
 * Returns `ok(true)` when the directory was removed, `ok(false)` when the
 * workspace is not an owned local worktree (nothing to do).
 */
export async function removeOwnedLocalWorktreeDirectory(
  dependencies: Pick<TaskLifecycleDependencies, 'getFilesRuntimeClient' | 'runtimes'>,
  workspace: LocalWorkspaceCleanupTarget,
  projectPath: string
): Promise<Result<boolean, OwnedWorktreeCleanupError>> {
  if (!workspace.path || !isLocalWorkspace(workspace)) return ok(false);

  const workspacePath = path.resolve(workspace.path);
  const projectRootPath = path.resolve(projectPath);
  if (workspacePath === projectRootPath) {
    if (workspace.kind === 'worktree') {
      return err({
        type: 'project-root-refused',
        path: workspace.path,
        message: `Refusing to remove project root path "${workspace.path}"`,
      });
    }
    return ok(false);
  }

  if (!isWorktreeWorkspace(workspace)) return ok(false);

  const client = await dependencies.getFilesRuntimeClient();
  const files = filesClientScope(client, path.dirname(workspacePath));
  const removal = await client.mutations.delete({
    ...fileMutationKey(files, workspacePath),
    recursive: true,
  });
  if (!removal.success && !isFileNotFoundError(removal.error)) {
    return err({
      type: 'removal-failed',
      path: workspace.path,
      message: fsErrorMessage(removal.error),
    });
  }

  if (await pathExists(dependencies, workspacePath)) {
    return err({
      type: 'removal-failed',
      path: workspace.path,
      message: `Failed to remove worktree directory "${workspace.path}"`,
    });
  }

  await pruneGitWorktrees(dependencies, projectPath);
  return ok(true);
}

export async function removeOwnedLocalWorktreeDirectoryIfUnused(
  dependencies: Pick<TaskLifecycleDependencies, 'db' | 'getFilesRuntimeClient' | 'runtimes'>,
  workspace: LocalWorkspaceCleanupTarget & { id: string },
  projectPath: string,
  excludeArchived: boolean
): Promise<Result<boolean, OwnedWorktreeCleanupError>> {
  if (await workspaceHasRemainingTasks(dependencies.db, workspace.id, excludeArchived)) {
    return ok(false);
  }
  return removeOwnedLocalWorktreeDirectory(dependencies, workspace, projectPath);
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
  db: AppDb,
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

  if (await workspaceHasRemainingTasks(db, workspace.id, excludeArchived)) return false;

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
 * Deletes the workspace row and unregisters its file-search root only when no other task still
 * references it.
 *
 * Tasks are deduplicated onto a single workspace row per resolved path (see
 * `WorkspaceBootstrapService.persistPath`), so for `no-worktree` tasks every task in a
 * project shares the project-root workspace. Deleting it unconditionally orphaned the
 * siblings, whose `workspaceId` then pointed at a missing row — surfacing later as
 * `Workspace not found` during bootstrap. `excludeTaskId` is the task being deleted; its
 * row still exists at this point, so it must not count as a reference.
 */
export async function deleteWorkspaceIfUnused(
  dependencies: Pick<TaskLifecycleDependencies, 'db' | 'unregisterFileSearchRoot'>,
  workspaceId: string,
  excludeTaskId: string
): Promise<void> {
  const [wsRow] = await dependencies.db
    .select({
      id: workspaces.id,
      kind: workspaces.kind,
      type: workspaces.type,
      location: workspaces.location,
      path: workspaces.path,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);

  // project-root workspaces outlive any individual task — never delete them.
  if (wsRow?.kind === 'project-root') return;

  const [sibling] = await dependencies.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaceId), ne(tasks.id, excludeTaskId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (sibling) return;

  try {
    if (wsRow?.path && isLocalWorkspace(wsRow)) {
      await dependencies.unregisterFileSearchRoot(hostPathFromNative(path.resolve(wsRow.path)));
    }
    await dependencies.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  } catch (e) {
    log.warn('deleteWorkspaceIfUnused: workspace row deletion failed', {
      workspaceId,
      error: String(e),
    });
  }
}

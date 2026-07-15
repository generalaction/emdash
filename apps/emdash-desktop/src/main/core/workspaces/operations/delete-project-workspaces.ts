import { eq } from 'drizzle-orm';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { unregisterFileSearchRoot } from '@main/core/file-search/runtime-client';
import { mutationResult, repositorySelector } from '@main/core/git/runtime-client';
import { runRuntimeLiveJob } from '@main/core/runtime/live-job';
import { taskService } from '@main/core/tasks/task-service';
import { getGitRuntimeClient } from '@main/core/wire-workers/accessors';
import {
  getWorkspaceRuntimeClient,
  hostFileRefFromNativePath,
} from '@main/core/workspaces/runtime/workspace-runtime-host';
import { db } from '@main/db/client';
import { workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { hostPathFromNative } from '@shared/core/runtime/paths';
import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspaceRow,
} from '@shared/core/workspaces/project-workspaces';
import { getProjectWorkspaceProject, listProjectWorkspaces } from './list-project-workspaces';

export async function deleteProjectWorkspaces(input: {
  projectId: string;
  paths: string[];
}): Promise<ProjectWorkspaceActionSummary> {
  if (input.paths.length === 0) return { succeededCount: 0, failedCount: 0, results: [] };

  const [project, rows] = await Promise.all([
    getProjectWorkspaceProject(input.projectId),
    listProjectWorkspaces(input.projectId),
  ]);
  const rowsByPath = new Map(rows.rows.map((row) => [row.path, row]));
  const results: ProjectWorkspaceActionResult[] = [];

  for (const targetPath of input.paths) {
    const row = rowsByPath.get(targetPath);
    if (!row) {
      results.push({
        path: targetPath,
        success: false,
        reason: 'workspace-not-found',
        message: 'Workspace was not found.',
      });
      continue;
    }
    results.push(await deleteProjectWorkspaceRow(input.projectId, project.path, row));
  }

  const succeededCount = results.filter((result) => result.success).length;
  return {
    succeededCount,
    failedCount: results.length - succeededCount,
    results,
  };
}

async function deleteProjectWorkspaceRow(
  projectId: string,
  projectPath: string,
  row: ProjectWorkspaceRow
): Promise<ProjectWorkspaceActionResult> {
  if (row.kind === 'root') {
    return {
      path: row.path,
      workspaceId: row.workspaceId ?? undefined,
      success: false,
      reason: 'root-refused',
      message: 'Repository root cannot be deleted.',
    };
  }

  if (!row.canDelete) {
    return {
      path: row.path,
      workspaceId: row.workspaceId ?? undefined,
      success: false,
      reason: 'unsupported-workspace',
      message: 'This workspace does not support deletion.',
    };
  }

  try {
    if (row.tasks.length > 0) {
      for (const task of row.tasks) {
        await taskService.deleteTask(projectId, task.taskId, {
          deleteWorktree: true,
          deleteBranch: false,
        });
      }
      return success(row);
    }

    if (row.pathState !== 'missing') {
      const client = await getWorkspaceRuntimeClient();
      const result = await runRuntimeLiveJob(workspaceContract.teardown, client.teardown, {
        workspace: hostFileRefFromNativePath(row.path),
        force: true,
        lifecycle: {
          ref: {
            kind: 'worktree',
            repoPath: projectPath,
            path: row.path,
            branchName: row.branch ?? 'HEAD',
          },
          context: {
            repoPath: projectPath,
            preservePatterns: [],
          },
          teardownPlan: {
            steps: [
              {
                id: 'remove-worktree:1',
                label: `Remove worktree ${row.path}`,
                step: {
                  kind: 'remove-worktree',
                  args: { path: row.path },
                },
              },
            ],
          },
        },
      });
      if (!result.success) {
        return {
          path: row.path,
          workspaceId: row.workspaceId ?? undefined,
          success: false,
          reason: 'delete-failed',
          message: result.error.message,
        };
      }
    }

    if (row.workspaceId) await deleteWorkspaceRow(row.workspaceId, row.path);
    await pruneGitWorktrees(projectPath);
    return success(row);
  } catch (error) {
    return {
      path: row.path,
      workspaceId: row.workspaceId ?? undefined,
      success: false,
      reason: 'delete-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deleteWorkspaceRow(workspaceId: string, workspacePath: string): Promise<void> {
  try {
    await unregisterFileSearchRoot(hostPathFromNative(workspacePath));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  } catch (error) {
    log.warn('deleteProjectWorkspaces: workspace row deletion failed', {
      workspaceId,
      error: String(error),
    });
    throw error;
  }
}

async function pruneGitWorktrees(projectPath: string): Promise<void> {
  try {
    const git = await getGitRuntimeClient();
    const result = await mutationResult(
      git.repository.model.mutate('pruneWorktrees', {
        key: repositorySelector(projectPath),
        input: {},
      })
    );
    if (!result.success) throw new Error(String(result.error));
  } catch (error) {
    log.warn('deleteProjectWorkspaces: git worktree prune failed', {
      projectPath,
      error: String(error),
    });
  }
}

function success(row: ProjectWorkspaceRow): ProjectWorkspaceActionResult {
  return {
    path: row.path,
    workspaceId: row.workspaceId ?? undefined,
    success: true,
    reclaimedBytes: row.usage?.totalBytes,
  };
}

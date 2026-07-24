import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspaceRow,
} from '@core/primitives/workspaces/api';
import type { OperationsEngine } from '@core/services/operations/node';
import {
  getProjectWorkspaceProject,
  listProjectWorkspaces,
  type ListProjectWorkspacesDependencies,
} from './list-project-workspaces';
import { enqueueDeleteWorkspacePath } from './workspace-lifecycle-definitions';

export async function deleteProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies & {
    operations: OperationsEngine;
    taskService: Pick<TaskService, 'deleteTask'>;
  },
  input: {
    projectId: string;
    paths: string[];
  }
): Promise<ProjectWorkspaceActionSummary> {
  if (input.paths.length === 0) return { succeededCount: 0, failedCount: 0, results: [] };

  const [project, rows] = await Promise.all([
    getProjectWorkspaceProject(dependencies.db, input.projectId),
    listProjectWorkspaces(dependencies, input.projectId),
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
    results.push(await deleteProjectWorkspaceRow(dependencies, input.projectId, project.path, row));
  }

  const succeededCount = results.filter((result) => result.success).length;
  return {
    succeededCount,
    failedCount: results.length - succeededCount,
    results,
  };
}

async function deleteProjectWorkspaceRow(
  dependencies: {
    operations: OperationsEngine;
    taskService: Pick<TaskService, 'deleteTask'>;
  },
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
        await dependencies.taskService.deleteTask(dependencies.operations, projectId, task.taskId, {
          deleteWorktree: true,
          deleteBranch: false,
        });
      }
      return success(row);
    }

    if (row.pathState === 'missing' && !row.workspaceId) {
      return success(row);
    }

    const result = await enqueueDeleteWorkspacePath(dependencies.operations, {
      projectId,
      workspaceId: row.workspaceId ?? undefined,
      workspacePath: row.path,
      branchName: row.branch ?? undefined,
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

function success(row: ProjectWorkspaceRow): ProjectWorkspaceActionResult {
  return {
    path: row.path,
    workspaceId: row.workspaceId ?? undefined,
    success: true,
    reclaimedBytes: row.usage?.totalBytes,
  };
}

import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspaceRow,
} from '@core/primitives/workspaces/api';
import type { OperationsService } from '@main/core/operations/operations-service';
import { taskService } from '@main/core/tasks/task-service';
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
    const operationsService = await getOperationsService();
    await operationsService.initialize();
    if (row.tasks.length > 0) {
      for (const task of row.tasks) {
        await taskService.deleteTask(projectId, task.taskId, {
          deleteWorktree: true,
          deleteBranch: false,
        });
      }
      return success(row);
    }

    if (row.pathState === 'missing' && !row.workspaceId) {
      return success(row);
    }

    const result = await operationsService.enqueueDeleteWorkspacePath({
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

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
}

import { taskService } from '@main/core/tasks/task-service';
import type {
  StorageDeleteTaskResult,
  StorageDeleteTasksResult,
} from '@shared/core/storage/storage';
import {
  getTaskStorageRows,
  isLocalTaskWorkspace,
  isWorktreeRow,
  type TaskStorageRow,
} from '../task-storage-rows';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deleteStorageTask(row: TaskStorageRow): Promise<StorageDeleteTaskResult> {
  if (row.projectType !== 'local' || row.workspaceKind === 'byoi') {
    return {
      taskId: row.taskId,
      projectId: row.projectId,
      taskName: row.taskName,
      success: false,
      reason: 'unsupported-workspace',
      message: 'Only local tasks are supported by storage cleanup in this version.',
    };
  }

  if (isWorktreeRow(row) && !isLocalTaskWorkspace(row)) {
    return {
      taskId: row.taskId,
      projectId: row.projectId,
      taskName: row.taskName,
      success: false,
      reason: 'unsupported-workspace',
      message: 'Remote task worktrees are not supported by storage cleanup yet.',
    };
  }

  try {
    await taskService.deleteTask(row.projectId, row.taskId, {
      deleteWorktree: true,
      deleteBranch: false,
    });
    return {
      taskId: row.taskId,
      projectId: row.projectId,
      taskName: row.taskName,
      success: true,
    };
  } catch (error) {
    return {
      taskId: row.taskId,
      projectId: row.projectId,
      taskName: row.taskName,
      success: false,
      reason: 'delete-failed',
      message: errorMessage(error),
    };
  }
}

export async function deleteStorageTasks(taskIds: string[]): Promise<StorageDeleteTasksResult> {
  if (taskIds.length === 0) return { deletedCount: 0, failedCount: 0, results: [] };

  const rows = await getTaskStorageRows();
  const rowsByTaskId = new Map(rows.map((row) => [row.taskId, row]));
  const results: StorageDeleteTaskResult[] = [];

  for (const taskId of taskIds) {
    const row = rowsByTaskId.get(taskId);
    if (!row) {
      results.push({
        taskId,
        projectId: '',
        taskName: taskId,
        success: false,
        reason: 'task-not-found',
        message: 'Task was not found.',
      });
      continue;
    }
    results.push(await deleteStorageTask(row));
  }

  const deletedCount = results.filter((result) => result.success).length;
  return {
    deletedCount,
    failedCount: results.length - deletedCount,
    results,
  };
}

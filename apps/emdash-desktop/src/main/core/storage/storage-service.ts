import { measureTaskStorage } from '@emdash/core/storage';
import { eq } from 'drizzle-orm';
import { hasWorktreeGitMarker } from '@main/core/tasks/operations/task-lifecycle-utils';
import { taskService } from '@main/core/tasks/task-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import type {
  ProjectStorageUsage,
  StorageDeleteTaskResult,
  StorageDeleteTasksResult,
  StoragePathState,
  StorageUsageResult,
  TaskStorageUsage,
} from '@shared/core/storage/storage';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';

type TaskStorageRow = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastInteractedAt: string | null;
  archivedAt: string | null;
  workspaceId: string | null;
  workspaceType: 'local' | 'project-ssh' | 'byoi' | null;
  workspaceKind: 'worktree' | 'project-root' | 'byoi' | null;
  workspaceLocation: 'local' | 'remote' | null;
  workspacePath: string | null;
  workspaceBranchName: string | null;
  workspaceConfig: WorkspaceConfig | null;
};

const MEASURE_CONCURRENCY = 4;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  mapItem: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapItem(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function isWorktreeRow(row: TaskStorageRow): boolean {
  return (
    row.workspaceKind === 'worktree' ||
    (!row.workspaceKind &&
      !!getProvisionedWorkspaceBranch({
        kind: row.workspaceKind,
        branchName: row.workspaceBranchName,
        config: row.workspaceConfig,
      }))
  );
}

function isLocalTaskWorkspace(row: TaskStorageRow): boolean {
  if (row.projectType !== 'local') return false;
  if (row.workspaceLocation === 'remote') return false;
  if (row.workspaceType === 'project-ssh' || row.workspaceType === 'byoi') return false;
  return true;
}

async function getRows(projectId?: string): Promise<TaskStorageRow[]> {
  const query = db
    .select({
      taskId: tasks.id,
      taskName: tasks.name,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectPath: projects.path,
      projectType: projects.workspaceProvider,
      status: tasks.status,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      lastInteractedAt: tasks.lastInteractedAt,
      archivedAt: tasks.archivedAt,
      workspaceId: workspaces.id,
      workspaceType: workspaces.type,
      workspaceKind: workspaces.kind,
      workspaceLocation: workspaces.location,
      workspacePath: workspaces.path,
      workspaceBranchName: workspaces.branchName,
      workspaceConfig: workspaces.config,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id));

  const rows = projectId ? await query.where(eq(tasks.projectId, projectId)) : await query;
  return rows.sort((a, b) => {
    const projectCompare = a.projectName.localeCompare(b.projectName);
    if (projectCompare !== 0) return projectCompare;
    return b.updatedAt.localeCompare(a.updatedAt);
  }) as TaskStorageRow[];
}

async function measureRow(row: TaskStorageRow): Promise<TaskStorageUsage> {
  const branchName = getProvisionedWorkspaceBranch({
    kind: row.workspaceKind,
    branchName: row.workspaceBranchName,
    config: row.workspaceConfig,
  });
  const worktree = isWorktreeRow(row);
  const localWorkspace = isLocalTaskWorkspace(row);
  const isActive = !!taskSessionManager.getTask(row.taskId);
  const canDelete =
    row.projectType === 'local' && row.workspaceKind !== 'byoi' && (!worktree || localWorkspace);

  const base: TaskStorageUsage = {
    taskId: row.taskId,
    taskName: row.taskName,
    projectId: row.projectId,
    projectName: row.projectName,
    projectPath: row.projectPath,
    projectType: row.projectType === 'ssh' ? 'ssh' : 'local',
    status: row.status as TaskLifecycleStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastInteractedAt: row.lastInteractedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    workspacePath: row.workspacePath ?? undefined,
    branchName: branchName ?? undefined,
    pathState: 'no-path',
    isActive,
    canDelete,
    reclaimableBytes: 0,
    errors: [],
  };

  if (!row.workspaceId || !row.workspacePath) {
    return { ...base, pathState: row.workspacePath ? 'not-worktree' : 'no-path' };
  }

  if (!worktree) {
    return { ...base, pathState: 'not-worktree' };
  }

  if (!localWorkspace) {
    return { ...base, pathState: 'remote', canDelete: false };
  }

  const usage = await measureTaskStorage(row.workspacePath);
  const hasGitMarker =
    usage.exists && usage.isDirectory ? await hasWorktreeGitMarker(row.workspacePath) : false;
  const pathState: StoragePathState = !usage.exists
    ? 'missing'
    : usage.isDirectory
      ? usage.errors.length > 0
        ? 'error'
        : hasGitMarker
          ? 'measured'
          : 'not-worktree'
      : 'error';

  return {
    ...base,
    pathState,
    canDelete,
    reclaimableBytes: usage.reclaimableBytes,
    errors: usage.errors,
  };
}

function groupProjects(tasksUsage: TaskStorageUsage[]): ProjectStorageUsage[] {
  const projectsById = new Map<string, ProjectStorageUsage>();

  for (const task of tasksUsage) {
    let project = projectsById.get(task.projectId);
    if (!project) {
      project = {
        projectId: task.projectId,
        projectName: task.projectName,
        projectPath: task.projectPath,
        projectType: task.projectType,
        taskCount: 0,
        reclaimableBytes: 0,
        tasks: [],
      };
      projectsById.set(task.projectId, project);
    }

    project.taskCount += 1;
    project.reclaimableBytes += task.reclaimableBytes;
    project.tasks.push(task);
  }

  return Array.from(projectsById.values()).map((project) => ({
    ...project,
    tasks: project.tasks.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes),
  }));
}

export async function listTaskStorageUsage(projectId?: string): Promise<StorageUsageResult> {
  const rows = await getRows(projectId);
  const measuredTasks = await mapWithConcurrency(rows, MEASURE_CONCURRENCY, measureRow);
  const projectsUsage = groupProjects(measuredTasks);

  return {
    scannedAt: new Date().toISOString(),
    taskCount: measuredTasks.length,
    reclaimableBytes: measuredTasks.reduce((sum, task) => sum + task.reclaimableBytes, 0),
    projects: projectsUsage,
  };
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

  const rows = await getRows();
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

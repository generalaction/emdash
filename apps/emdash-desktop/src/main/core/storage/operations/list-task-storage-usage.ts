import { FileSystem, isFileNotFoundError } from '@emdash/core/files';
import { hasWorktreeGitMarker } from '@main/core/tasks/operations/task-lifecycle-utils';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import type {
  ProjectStorageUsage,
  StoragePathState,
  StorageUsageResult,
  TaskStorageUsage,
} from '@shared/core/storage/storage';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import {
  getTaskStorageRows,
  isLocalTaskWorkspace,
  isWorktreeRow,
  type TaskStorageRow,
} from '../task-storage-rows';

const MEASURE_CONCURRENCY = 4;

// Usage listing only measures local worktrees (remote rows short-circuit
// below), so the local core FileSystem is used directly.
const localFileSystem = new FileSystem();

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

  const usage = await localFileSystem.measureUsage(row.workspacePath);
  if (!usage.success) {
    if (isFileNotFoundError(usage.error)) {
      return { ...base, pathState: 'missing' };
    }
    return {
      ...base,
      pathState: 'error',
      errors: [{ path: usage.error.path, message: usage.error.message }],
    };
  }

  if (usage.data.type !== 'directory') {
    return {
      ...base,
      pathState: 'error',
      errors: [{ path: usage.data.path, message: 'Path is not a directory.' }],
    };
  }

  const hasGitMarker = await hasWorktreeGitMarker(row.workspacePath);
  const pathState: StoragePathState =
    usage.data.errors.length > 0 ? 'error' : hasGitMarker ? 'measured' : 'not-worktree';

  return {
    ...base,
    pathState,
    canDelete,
    reclaimableBytes: usage.data.exclusiveDiskBytes,
    errors: usage.data.errors,
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
  const rows = await getTaskStorageRows(projectId);
  const measuredTasks = await mapWithConcurrency(rows, MEASURE_CONCURRENCY, measureRow);
  const projectsUsage = groupProjects(measuredTasks);

  return {
    scannedAt: new Date().toISOString(),
    taskCount: measuredTasks.length,
    reclaimableBytes: measuredTasks.reduce((sum, task) => sum + task.reclaimableBytes, 0),
    projects: projectsUsage,
  };
}

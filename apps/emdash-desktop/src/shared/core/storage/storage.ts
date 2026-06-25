import type { StorageScanError } from '@emdash/core/storage';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';

export type StoragePathState =
  | 'measured'
  | 'missing'
  | 'not-worktree'
  | 'remote'
  | 'no-path'
  | 'error';

export type TaskStorageUsage = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectType: 'local' | 'ssh';
  status: TaskLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  lastInteractedAt?: string;
  archivedAt?: string;
  workspaceId?: string;
  workspacePath?: string;
  branchName?: string;
  pathState: StoragePathState;
  isActive: boolean;
  canDelete: boolean;
  reclaimableBytes: number;
  errors: StorageScanError[];
};

export type ProjectStorageUsage = {
  projectId: string;
  projectName: string;
  projectPath: string;
  projectType: 'local' | 'ssh';
  taskCount: number;
  reclaimableBytes: number;
  tasks: TaskStorageUsage[];
};

export type StorageUsageResult = {
  scannedAt: string;
  taskCount: number;
  reclaimableBytes: number;
  projects: ProjectStorageUsage[];
};

export type StorageDeleteTaskResult =
  | {
      taskId: string;
      projectId: string;
      taskName: string;
      success: true;
    }
  | {
      taskId: string;
      projectId: string;
      taskName: string;
      success: false;
      reason: 'unsupported-workspace' | 'delete-failed' | 'task-not-found';
      message: string;
    };

export type StorageDeleteTasksResult = {
  deletedCount: number;
  failedCount: number;
  results: StorageDeleteTaskResult[];
};

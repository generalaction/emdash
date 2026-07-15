import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';

export type ProjectWorkspacePathState =
  | 'measured'
  | 'missing'
  | 'not-worktree'
  | 'remote'
  | 'no-path'
  | 'error';

export type ProjectWorkspaceTask = {
  taskId: string;
  name: string;
  status: TaskLifecycleStatus;
  archivedAt?: string;
  updatedAt: string;
  lastInteractedAt?: string;
};

export type ProjectWorkspaceUsage = {
  totalBytes: number;
  artifactBytes: number;
  errors: { path: string; message: string }[];
};

export type ProjectWorkspaceRow = {
  kind: 'root' | 'workspace' | 'candidate';
  projectId: string;
  workspaceId: string | null;
  path: string;
  branch?: string;
  tasks: ProjectWorkspaceTask[];
  usage: ProjectWorkspaceUsage | null;
  pathState: ProjectWorkspacePathState;
  canCleanArtifacts: boolean;
  canDelete: boolean;
  hasActiveSessions: boolean;
  lastActivityAt?: string;
  errors: { path: string; message: string }[];
};

export type ProjectWorkspacesResult = {
  scannedAt: string;
  projectId: string;
  rows: ProjectWorkspaceRow[];
  totalBytes: number;
  artifactBytes: number;
  warnings: string[];
};

export type MeasureProjectWorkspacesInput = {
  projectId: string;
  paths: string[];
};

export type ProjectWorkspaceUsageResult =
  | {
      path: string;
      success: true;
      usage: ProjectWorkspaceUsage;
    }
  | {
      path: string;
      success: false;
      message: string;
      errors?: { path: string; message: string }[];
    };

export type MeasureProjectWorkspacesResult = {
  scannedAt: string;
  projectId: string;
  results: ProjectWorkspaceUsageResult[];
};

export type ProjectWorkspaceActionReason =
  | 'workspace-not-found'
  | 'unsupported-workspace'
  | 'root-refused'
  | 'missing-path'
  | 'clean-failed'
  | 'delete-failed';

export type ProjectWorkspaceActionResult =
  | {
      path: string;
      workspaceId?: string;
      success: true;
      reclaimedBytes?: number;
    }
  | {
      path: string;
      workspaceId?: string;
      success: false;
      reason: ProjectWorkspaceActionReason;
      message: string;
    };

export type ProjectWorkspaceActionSummary = {
  succeededCount: number;
  failedCount: number;
  results: ProjectWorkspaceActionResult[];
};

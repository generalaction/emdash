import type { TaskLifecycleStatus } from '@core/primitives/tasks/api';
import type {
  WorkspaceCreateOutcome,
  WorkspaceRemovalAttempt,
  WorkspaceRuntimeOverlay,
  WorkspaceScriptOutcomes,
} from './workspace-registry-observations';

export type ProjectWorkspacePathState =
  | 'measured'
  | 'missing'
  | 'not-worktree'
  | 'remote'
  | 'no-path'
  | 'error';

export type ProjectWorkspacePathIssue = {
  kind: 'path-gone' | 'prunable';
  reason?: string;
};

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
  /** Mirror-derived stats; `added` includes untracked files' lines (registry contract). */
  gitStats: ProjectWorkspaceGitStats | null;
  pathState: ProjectWorkspacePathState;
  pathIssue?: ProjectWorkspacePathIssue;
  canCleanArtifacts: boolean;
  canDelete: boolean;
  hasActiveSessions: boolean;
  lastActivityAt?: string;
  observedStatus?: 'present' | 'missing';
  /** ISO stamp of the host observation the row was read from; staleness is displayed. */
  lastObservedAt?: string;
  /** Deletion tombstone presence (ADR 0006): a visible pending deletion until the sweep converges. */
  pendingRemoval: boolean;
  /** Host-written last failed removal attempt; a `terminal` class stops auto-retry. */
  lastRemovalAttempt?: WorkspaceRemovalAttempt;
  /** Durable outcome of the last create run on the workspace record. */
  lastCreateOutcome?: WorkspaceCreateOutcome;
  /** Durable per-script (prepare/setup/run) last outcomes; survive daemon restarts. */
  scriptOutcomes?: WorkspaceScriptOutcomes;
  /** Live host runtime overlay (creation stage, script notices); cleared on daemon restart. */
  runtimeOverlay?: WorkspaceRuntimeOverlay;
  errors: { path: string; message: string }[];
};

/**
 * Needs-attention derives purely from tombstone presence plus a terminal-class last
 * removal attempt (ADR 0006): auto-retry has stopped and the user decides between
 * Retry and Untrack-anyway.
 */
export function workspaceRemovalNeedsAttention(
  row: Pick<ProjectWorkspaceRow, 'pendingRemoval' | 'lastRemovalAttempt'>
): boolean {
  return row.pendingRemoval && row.lastRemovalAttempt?.class === 'terminal';
}

export type ProjectWorkspacesResult = {
  scannedAt: string;
  projectId: string;
  rows: ProjectWorkspaceRow[];
  totalBytes: number;
  artifactBytes: number;
  warnings: string[];
};

/** One machines-page group per project on a host, served live from the mirror. */
export type HostWorkspaceGroup = {
  project: { id: string; name: string };
  workspaces: ProjectWorkspaceRow[];
  warnings: string[];
};

export type HostWorkspaceGroupsData = {
  groups: HostWorkspaceGroup[];
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

export type ProjectWorkspaceGitStats = {
  added: number;
  removed: number;
  ahead: number;
  behind: number;
};

export type GetProjectWorkspaceGitStatsInput = {
  projectId: string;
  paths: string[];
};

export type ProjectWorkspaceGitStatsResult =
  | {
      path: string;
      success: true;
      stats: ProjectWorkspaceGitStats;
    }
  | {
      path: string;
      success: false;
      message: string;
    };

export type GetProjectWorkspaceGitStatsResult = {
  scannedAt: string;
  projectId: string;
  results: ProjectWorkspaceGitStatsResult[];
};

export type ProjectWorkspaceActionReason =
  | 'workspace-not-found'
  | 'unsupported-workspace'
  | 'root-refused'
  | 'missing-path'
  | 'clean-failed'
  | 'archive-failed'
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

import type { WorkspaceConfig } from './workspace-config';
import type { WorkspaceKind } from './workspaces';

/**
 * A workspace belonging to a project, as returned by `getProjectWorkspaces`.
 * Includes the project-root workspace and all worktrees linked through tasks.
 */
export type ProjectWorkspace = {
  id: string;
  kind: WorkspaceKind;
  path: string | null;
  branchName: string | null;
  config: WorkspaceConfig | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  /** The task that owns this workspace, if any. Null for the project-root workspace. */
  taskId: string | null;
  taskName: string | null;
  /** Whether the workspace is currently acquired in the in-memory registry. */
  isLive: boolean;
  /** Number of non-archived tasks currently linked to this workspace. */
  linkedTaskCount: number;
};

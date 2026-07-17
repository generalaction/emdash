import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { WorkspaceKind } from '@core/primitives/workspaces/api';
import { deriveBranchName } from '../tasks/resolve-workspace-intent';

type WorkspaceBranchRow = {
  kind?: WorkspaceKind | string | null;
  branchName?: string | null;
  config?: WorkspaceConfig | null;
};

export function getProvisionedWorkspaceBranch(workspace: WorkspaceBranchRow): string | null {
  if (workspace.kind === 'project-root' || workspace.kind === 'byoi') return null;
  if (workspace.kind === 'path') return null;

  if (workspace.config) return deriveBranchName(workspace.config.git);
  if (workspace.kind === 'worktree') return workspace.branchName ?? null;

  return workspace.branchName ?? null;
}

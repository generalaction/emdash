import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { WorkspaceKind } from '@shared/core/workspaces/workspaces';
import { deriveBranchName } from '../tasks/resolve-workspace-intent';

type WorkspaceBranchRow = {
  kind?: WorkspaceKind | string | null;
  branchName?: string | null;
  config?: WorkspaceConfig | null;
};

export function getProvisionedWorkspaceBranch(workspace: WorkspaceBranchRow): string | null {
  if (workspace.config) return deriveBranchName(workspace.config.git);

  if (workspace.kind === 'project-root' || workspace.kind === 'byoi') return null;
  if (workspace.kind === 'worktree') return workspace.branchName ?? null;
  if (workspace.kind === 'path') return null;

  return workspace.branchName ?? null;
}

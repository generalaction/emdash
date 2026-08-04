export type WorkspaceType = 'local' | 'project-ssh';

/**
 * Describes the physical nature of a workspace directory.
 * Stored in `workspaces.kind`; `null` for legacy rows (see `resolveWorkspaceKind`).
 */
export type WorkspaceKind = 'worktree' | 'project-root' | 'path' | 'repository' | 'directory';

export type RegistryWorkspaceKind = 'repository' | 'worktree' | 'directory';

export function normalizeWorkspaceKind(
  kind: WorkspaceKind | null | undefined
): RegistryWorkspaceKind {
  switch (kind) {
    case 'project-root':
    case 'repository':
      return 'repository';
    case 'path':
    case 'directory':
      return 'directory';
    case 'worktree':
    case null:
    case undefined:
      return 'worktree';
  }
}

export type WorkspaceResolution =
  | { kind: 'ready' }
  | { kind: 'needs_create' }
  | { kind: 'branch_elsewhere'; branchName: string; candidatePath: string; previousPath: string }
  | { kind: 'path_missing'; previousPath: string; branchName: string | null };

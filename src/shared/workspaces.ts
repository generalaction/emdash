export type WorkspaceType = 'local' | 'project-ssh' | 'byoi';

/**
 * Describes the physical nature of a workspace directory.
 * Stored in `workspaces.kind`; `null` for legacy rows (see `resolveWorkspaceKind`).
 */
export type WorkspaceKind = 'worktree' | 'project-root' | 'path' | 'byoi';

export type WorkspaceResolution =
  | { kind: 'ready' }
  | { kind: 'needs_create' }
  | { kind: 'branch_elsewhere'; taskBranch: string; candidatePath: string; previousPath: string }
  | { kind: 'path_missing'; previousPath: string; taskBranch: string | null };

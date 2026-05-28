export type WorkspaceType = 'local' | 'project-ssh' | 'byoi';

export type WorktreeEntry = {
  path: string;
  branch: string | null; // null = detached HEAD
  isMain: boolean; // true for the project root worktree
};

export type WorkspaceResolution =
  | { kind: 'ready' }
  | { kind: 'needs_create' }
  | { kind: 'branch_elsewhere'; taskBranch: string; candidatePath: string; previousPath: string }
  | { kind: 'path_missing'; previousPath: string; taskBranch: string | null };

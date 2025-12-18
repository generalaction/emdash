/**
 * Git-related types used across the renderer.
 */

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isStaged: boolean;
  diff?: string;
}

export interface WorkspaceChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

export interface WorkspaceChanges {
  workspaceId: string;
  changes: WorkspaceChange[];
  totalAdditions: number;
  totalDeletions: number;
  isLoading: boolean;
  error?: string;
}

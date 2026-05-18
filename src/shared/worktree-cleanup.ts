export type ManagedWorktree = {
  workspaceId: string;
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
  branch: string | null;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  lastInteractedAt: string | null;
  archivedAt: string | null;
  status: 'active' | 'archived' | 'orphaned' | 'missing';
  cleanupEligible: boolean;
};

export type ManagedWorktreesSummary = {
  worktrees: ManagedWorktree[];
  totalSizeBytes: number;
  cleanedCount: number;
  cleanedSizeBytes: number;
  isRefreshing?: boolean;
};

export type ListManagedWorktreesOptions = {
  forceRefresh?: boolean;
  awaitSizes?: boolean;
};

export const WORKTREE_CREATION_EVENT_CHANNEL = 'worktree:creation:event' as const;

export const WORKTREE_CREATION_EVENT_STATUSES = [
  'starting',
  'progress',
  'completed',
  'failed',
  'cancelled',
] as const;

export type WorktreeCreationEventStatus = (typeof WORKTREE_CREATION_EVENT_STATUSES)[number];
export type WorktreeCreationStream = 'stdout' | 'stderr';

export interface WorktreeCreationEvent {
  taskId: string;
  projectId: string;
  status: WorktreeCreationEventStatus;
  timestamp: string;
  message?: string;
  stream?: WorktreeCreationStream;
  chunk?: string;
}

export const MAX_WORKTREE_CREATION_LOG_LINES = 400;

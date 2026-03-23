import type { PrCheckRun, PrCommentAuthor } from '@shared/pull-requests';

// Re-export shared types under renderer-friendly names
export type CheckRun = PrCheckRun;
export type { PrCommentAuthor } from '@shared/pull-requests';

export interface CheckRunsSummary {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  cancelled: number;
}

// PR Comments
export interface PrComment {
  id: string;
  author: PrCommentAuthor;
  body: string;
  createdAt: string;
  type: 'comment' | 'review';
  reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
}

import type { PrCheckRun, PrCommentAuthor } from '@shared/pull-requests';

// Re-export shared types under renderer-friendly names
export type CheckRun = PrCheckRun;
export type { PrCommentAuthor };

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

// Pull Requests
export interface PullRequestSummary {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  authorLogin: string | null;
  headRefOid: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
}

export interface PullRequestDetails extends PullRequestSummary {
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: 'CLEAN' | 'DIRTY' | 'BEHIND' | 'BLOCKED' | 'HAS_HOOKS' | 'UNSTABLE' | 'UNKNOWN';
  body: string | null;
}

import { GitHubReviewer, ReviewDecision } from '@main/core/github/services/pr-types';

export type PullRequestStatus = 'open' | 'closed' | 'merged';

export type CheckRunBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export type PullRequestAuthor = {
  userName: string;
  displayName?: string;
  avatarUrl?: string;
};

// Common fields all forges share
interface PullRequestBase {
  id: string;
  provider: string;
  url: string;
  title: string;
  status: PullRequestStatus;
  author: PullRequestAuthor | null;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

// GitHub-specific metadata
export interface GitHubPrMetadata {
  number: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  headRepository: {
    nameWithOwner: string;
    url: string;
    owner: { login: string };
  } | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatarUrl: string }>;
  reviewDecision: ReviewDecision;
  reviewers: GitHubReviewer[];
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: 'CLEAN' | 'DIRTY' | 'BEHIND' | 'BLOCKED' | 'HAS_HOOKS' | 'UNSTABLE' | 'UNKNOWN';
  body: string | null;
}

// Discriminated union — add new forges here
export type PullRequest = PullRequestBase & { provider: 'github'; metadata: GitHubPrMetadata };

export type PullRequestInput = Omit<PullRequest, 'id'>;

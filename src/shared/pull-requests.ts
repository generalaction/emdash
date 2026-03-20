export type PullRequestStatus = 'open' | 'closed' | 'merged';

export type CheckRunBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface GitHubReviewer {
  login: string;
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
}

export type PullRequestAuthor = {
  userName: string;
  displayName?: string;
  avatarUrl?: string;
};

// Common fields all forges share
interface PullRequestBase {
  id: string;
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

export type GitHubPullRequest = PullRequestBase & {
  provider: 'github';
  metadata: GitHubPrMetadata;
};

// Discriminated union — add new forges here
export type PullRequest = GitHubPullRequest;

// ── Pass-through types (service → renderer) ────────────────────────

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PrCheckRun {
  name: string;
  bucket: CheckRunBucket;
  workflowName?: string;
  appName?: string;
  appLogoUrl?: string;
  detailsUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PrCommentAuthor {
  login: string;
  avatarUrl?: string;
}

export interface PrCommentsResult {
  comments: Array<{
    id: number;
    author: PrCommentAuthor;
    body: string;
    createdAt: string;
  }>;
  reviews: Array<{
    id: number;
    author: PrCommentAuthor;
    body: string;
    submittedAt?: string;
    state: string;
  }>;
}

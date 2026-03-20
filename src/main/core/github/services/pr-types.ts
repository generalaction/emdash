import { CheckRunBucket } from '@shared/pull-requests';

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author: { login: string } | null;
  headRepository: {
    nameWithOwner: string;
    url: string;
    owner: { login: string };
  } | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatarUrl: string }>;
  reviewDecision: ReviewDecision;
  reviewers: GitHubReviewer[];
}

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface GitHubPullRequest extends GitHubPullRequestSummary {
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: 'CLEAN' | 'DIRTY' | 'BEHIND' | 'BLOCKED' | 'HAS_HOOKS' | 'UNSTABLE' | 'UNKNOWN';
  body: string | null;
}

export interface GitHubReviewer {
  login: string;
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
}

export interface GitHubPullRequestListResult {
  prs: GitHubPullRequestSummary[];
  totalCount: number;
}

export interface GitHubPullRequestListOptions {
  limit?: number;
  searchQuery?: string;
}

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

export interface GitHubPullRequestService {
  createPullRequest(params: {
    nameWithOwner: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }): Promise<{ url: string; number: number }>;

  getPullRequestDetails(nameWithOwner: string, prNumber: number): Promise<GitHubPullRequest | null>;

  listPullRequests(
    nameWithOwner: string,
    options?: GitHubPullRequestListOptions
  ): Promise<GitHubPullRequestListResult>;

  mergePullRequest(
    nameWithOwner: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ): Promise<{ sha: string | null; merged: boolean }>;

  addPrComment(nameWithOwner: string, prNumber: number, body: string): Promise<{ id: number }>;

  getPrComments(nameWithOwner: string, prNumber: number): Promise<PrCommentsResult>;

  getPullRequestFiles(nameWithOwner: string, prNumber: number): Promise<PullRequestFile[]>;

  getCheckRuns(nameWithOwner: string, prNumber: number): Promise<PrCheckRun[]>;
}

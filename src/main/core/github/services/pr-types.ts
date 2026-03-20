import type {
  PrCheckRun,
  PrCommentsResult,
  PullRequest,
  PullRequestFile,
} from '@shared/pull-requests';

export interface GitHubPullRequestListOptions {
  limit?: number;
  searchQuery?: string;
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

  getPullRequestDetails(nameWithOwner: string, prNumber: number): Promise<PullRequest | null>;

  listPullRequests(
    nameWithOwner: string,
    options?: GitHubPullRequestListOptions
  ): Promise<{ prs: PullRequest[]; totalCount: number }>;

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

import type { Octokit } from '@octokit/rest';
import { getOctokit } from './octokit-provider';
import { GET_PR_DETAIL_QUERY, LIST_PRS_QUERY, SEARCH_PRS_QUERY } from './pr-queries';
import { splitRepo } from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  reviewers: GitHubReviewer[];
}

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

export interface GitHubPullRequestService {
  listPullRequests(
    nameWithOwner: string,
    options?: GitHubPullRequestListOptions
  ): Promise<GitHubPullRequestListResult>;

  getPullRequestDetails(nameWithOwner: string, prNumber: number): Promise<GitHubPullRequest | null>;
}

// ---------------------------------------------------------------------------
// GraphQL response shape (internal)
// ---------------------------------------------------------------------------

interface GqlPrNode {
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
  body?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus?:
    | 'CLEAN'
    | 'DIRTY'
    | 'BEHIND'
    | 'BLOCKED'
    | 'HAS_HOOKS'
    | 'UNSTABLE'
    | 'UNKNOWN';
  author: { login: string } | null;
  headRepository: {
    nameWithOwner: string;
    url: string;
    owner: { login: string };
  } | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: Array<{ login: string; avatarUrl: string }> };
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  latestReviews: { nodes: Array<{ author: { login: string } | null; state: string }> };
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }>;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GitHubPullRequestServiceImpl implements GitHubPullRequestService {
  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  async listPullRequests(
    nameWithOwner: string,
    options: GitHubPullRequestListOptions = {}
  ): Promise<GitHubPullRequestListResult> {
    const { owner, repo } = splitRepo(nameWithOwner);
    const limit = Math.min(Math.max(options.limit !== undefined ? options.limit : 30, 1), 100);
    const searchQuery = options.searchQuery?.trim();

    try {
      const octokit = await this.getOctokit();
      if (searchQuery) {
        const response = await octokit.graphql<{
          search: { issueCount: number; nodes: GqlPrNode[] };
        }>(SEARCH_PRS_QUERY, {
          query: `${searchQuery} repo:${owner}/${repo} is:pr is:open`,
          limit,
        });
        return {
          prs: response.search.nodes.map((n) => this.mapToSummary(n)),
          totalCount: response.search.issueCount,
        };
      }

      const response = await octokit.graphql<{
        repository: { pullRequests: { totalCount: number; nodes: GqlPrNode[] } };
      }>(LIST_PRS_QUERY, { owner, repo, limit });
      return {
        prs: response.repository.pullRequests.nodes.map((n) => this.mapToSummary(n)),
        totalCount: response.repository.pullRequests.totalCount,
      };
    } catch {
      return { prs: [], totalCount: 0 };
    }
  }

  async getPullRequestDetails(
    nameWithOwner: string,
    prNumber: number
  ): Promise<GitHubPullRequest | null> {
    const { owner, repo } = splitRepo(nameWithOwner);
    try {
      const octokit = await this.getOctokit();
      const response = await octokit.graphql<{
        repository: { pullRequest: GqlPrNode | null };
      }>(GET_PR_DETAIL_QUERY, { owner, repo, number: prNumber });
      const node = response.repository.pullRequest;
      if (!node) return null;
      return this.mapToDetail(node);
    } catch {
      return null;
    }
  }

  private buildReviewers(node: GqlPrNode): GitHubReviewer[] {
    const reviewerMap = new Map<string, GitHubReviewer>();

    for (const req of node.reviewRequests.nodes) {
      const login = req.requestedReviewer?.login ?? req.requestedReviewer?.name;
      if (login) {
        reviewerMap.set(login, { login, state: 'PENDING' });
      }
    }

    for (const review of node.latestReviews.nodes) {
      const login = review.author?.login;
      if (login) {
        reviewerMap.set(login, { login, state: review.state as GitHubReviewer['state'] });
      }
    }

    return Array.from(reviewerMap.values());
  }

  private mapToSummary(node: GqlPrNode): GitHubPullRequestSummary {
    return {
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      isDraft: node.isDraft,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      headRefName: node.headRefName,
      headRefOid: node.headRefOid,
      baseRefName: node.baseRefName,
      author: node.author,
      headRepository: node.headRepository,
      labels: node.labels.nodes,
      assignees: node.assignees.nodes,
      reviewDecision: node.reviewDecision,
      reviewers: this.buildReviewers(node),
    };
  }

  private mapToDetail(node: GqlPrNode): GitHubPullRequest {
    return {
      ...this.mapToSummary(node),
      additions: node.additions ?? 0,
      deletions: node.deletions ?? 0,
      changedFiles: node.changedFiles ?? 0,
      mergeable: node.mergeable ?? 'UNKNOWN',
      mergeStateStatus: node.mergeStateStatus ?? 'UNKNOWN',
      body: node.body ?? null,
    };
  }
}

export const prService = new GitHubPullRequestServiceImpl(getOctokit);

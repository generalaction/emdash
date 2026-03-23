import type { Octokit } from '@octokit/rest';
import type {
  CheckRunBucket,
  GitHubReviewer,
  PrCheckRun,
  PrCommentsResult,
  PullRequest,
  PullRequestFile,
  PullRequestStatus,
} from '@shared/pull-requests';
import { getOctokit } from './octokit-provider';
import {
  GET_PR_CHECK_RUNS_QUERY,
  GET_PR_DETAIL_QUERY,
  LIST_PRS_QUERY,
  SEARCH_PRS_QUERY,
  SYNC_PRS_QUERY,
} from './pr-queries';
import type { GitHubPullRequestListOptions, GitHubPullRequestService } from './pr-types';
import { splitRepo } from './utils';

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
// Check-run helpers (module-level)
// ---------------------------------------------------------------------------

interface GqlCheckRunNode {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkSuite: {
    app: { name: string; logoUrl: string } | null;
    workflowRun: { workflow: { name: string } } | null;
  } | null;
}

interface GqlStatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string;
}

interface GqlCheckRunsResponse {
  repository: {
    pullRequest: {
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup: {
              contexts: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<GqlCheckRunNode | GqlStatusContextNode>;
              };
            } | null;
          };
        }>;
      };
    } | null;
  };
}

function mapCheckRunBucket(status: string, conclusion: string | null): CheckRunBucket {
  if (
    status === 'IN_PROGRESS' ||
    status === 'QUEUED' ||
    status === 'WAITING' ||
    status === 'PENDING'
  )
    return 'pending';
  if (!conclusion) return 'pending';
  switch (conclusion) {
    case 'SUCCESS':
      return 'pass';
    case 'NEUTRAL':
    case 'SKIPPED':
    case 'STALE':
      return 'skipping';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'fail';
    case 'CANCELLED':
      return 'cancel';
    default:
      return 'fail';
  }
}

function mapStatusContextBucket(state: string): CheckRunBucket {
  switch (state) {
    case 'SUCCESS':
      return 'pass';
    case 'FAILURE':
    case 'ERROR':
      return 'fail';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GitHubPullRequestServiceImpl implements GitHubPullRequestService {
  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  async listPullRequests(
    nameWithOwner: string,
    options: GitHubPullRequestListOptions = {}
  ): Promise<{ prs: PullRequest[]; totalCount: number }> {
    const { owner, repo } = splitRepo(nameWithOwner);
    const limit = Math.min(Math.max(options.limit !== undefined ? options.limit : 30, 1), 100);
    const searchQuery = options.searchQuery?.trim();

    const octokit = await this.getOctokit();
    if (searchQuery) {
      const response = await octokit.graphql<{
        search: { issueCount: number; nodes: GqlPrNode[] };
      }>(SEARCH_PRS_QUERY, {
        query: `${searchQuery} repo:${owner}/${repo} is:pr is:open`,
        limit,
      });
      return {
        prs: response.search.nodes.map((n) => this.mapToUnified(n, nameWithOwner)),
        totalCount: response.search.issueCount,
      };
    }

    const response = await octokit.graphql<{
      repository: { pullRequests: { totalCount: number; nodes: GqlPrNode[] } };
    }>(LIST_PRS_QUERY, { owner, repo, limit });
    return {
      prs: response.repository.pullRequests.nodes.map((n) => this.mapToUnified(n, nameWithOwner)),
      totalCount: response.repository.pullRequests.totalCount,
    };
  }

  async getPullRequestDetails(
    nameWithOwner: string,
    prNumber: number
  ): Promise<PullRequest | null> {
    const { owner, repo } = splitRepo(nameWithOwner);
    const octokit = await this.getOctokit();
    const response = await octokit.graphql<{
      repository: { pullRequest: GqlPrNode | null };
    }>(GET_PR_DETAIL_QUERY, { owner, repo, number: prNumber });
    const node = response.repository.pullRequest;
    if (!node) return null;
    return this.mapToUnified(node, nameWithOwner);
  }

  async getPullRequestFiles(nameWithOwner: string, prNumber: number): Promise<PullRequestFile[]> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async createPullRequest(params: {
    nameWithOwner: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }): Promise<{ url: string; number: number }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(params.nameWithOwner);
    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      head: params.head,
      base: params.base,
      title: params.title,
      body: params.body,
      draft: params.draft,
    });
    return { url: response.data.html_url, number: response.data.number };
  }

  async mergePullRequest(
    nameWithOwner: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ): Promise<{ sha: string | null; merged: boolean }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const response = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: options.strategy,
      sha: options.commitHeadOid,
    });
    return { sha: response.data.sha ?? null, merged: response.data.merged };
  }

  async getCheckRuns(nameWithOwner: string, prNumber: number): Promise<PrCheckRun[]> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);

    const allNodes: Array<GqlCheckRunNode | GqlStatusContextNode> = [];
    let cursor: string | undefined;

    for (;;) {
      const response: GqlCheckRunsResponse = await octokit.graphql(GET_PR_CHECK_RUNS_QUERY, {
        owner,
        repo,
        number: prNumber,
        cursor,
      });

      const contexts =
        response.repository.pullRequest?.commits.nodes[0]?.commit?.statusCheckRollup?.contexts;
      if (!contexts) break;

      allNodes.push(...contexts.nodes);
      if (!contexts.pageInfo.hasNextPage) break;
      cursor = contexts.pageInfo.endCursor ?? undefined;
    }

    return allNodes.map((node) => {
      if (node.__typename === 'CheckRun') {
        return {
          name: node.name,
          bucket: mapCheckRunBucket(node.status, node.conclusion),
          workflowName: node.checkSuite?.workflowRun?.workflow?.name,
          appName: node.checkSuite?.app?.name,
          appLogoUrl: node.checkSuite?.app?.logoUrl,
          detailsUrl: node.detailsUrl ?? undefined,
          startedAt: node.startedAt ?? undefined,
          completedAt: node.completedAt ?? undefined,
        };
      }
      return {
        name: node.context,
        bucket: mapStatusContextBucket(node.state),
        detailsUrl: node.targetUrl ?? undefined,
        startedAt: node.createdAt,
      };
    });
  }

  async getPrComments(nameWithOwner: string, prNumber: number): Promise<PrCommentsResult> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);

    const [commentsData, reviewsData] = await Promise.all([
      octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      }),
      octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);

    return {
      comments: commentsData.map((c) => ({
        id: c.id,
        author: { login: c.user?.login ?? 'unknown', avatarUrl: c.user?.avatar_url },
        body: c.body ?? '',
        createdAt: c.created_at,
      })),
      reviews: reviewsData
        .filter(
          (r) =>
            r.state !== 'PENDING' &&
            (r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
        )
        .map((r) => {
          const fallbackSubmittedAt =
            'updated_at' in r && typeof r.updated_at === 'string' ? r.updated_at : undefined;
          return {
            id: r.id,
            author: { login: r.user?.login ?? 'unknown', avatarUrl: r.user?.avatar_url },
            body: r.body ?? '',
            submittedAt: r.submitted_at ?? fallbackSubmittedAt,
            state: r.state,
          };
        }),
    };
  }

  async addPrComment(
    nameWithOwner: string,
    prNumber: number,
    body: string
  ): Promise<{ id: number }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    return { id: response.data.id };
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

  async syncPullRequests(nameWithOwner: string, sinceUpdatedAt?: string): Promise<PullRequest[]> {
    const { owner, repo } = splitRepo(nameWithOwner);
    const octokit = await this.getOctokit();
    const allPrs: PullRequest[] = [];
    let cursor: string | undefined;

    for (;;) {
      const response = await octokit.graphql<{
        repository: {
          pullRequests: {
            totalCount: number;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: GqlPrNode[];
          };
        };
      }>(SYNC_PRS_QUERY, { owner, repo, cursor });

      const { nodes, pageInfo } = response.repository.pullRequests;

      let reachedCursor = false;
      for (const node of nodes) {
        if (sinceUpdatedAt && node.updatedAt <= sinceUpdatedAt) {
          reachedCursor = true;
          break;
        }
        allPrs.push(this.mapToUnified(node, nameWithOwner));
      }

      if (reachedCursor || !pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor ?? undefined;
    }

    return allPrs;
  }

  async getPullRequestsByBranch(nameWithOwner: string, branchName: string): Promise<PullRequest[]> {
    const { owner, repo } = splitRepo(nameWithOwner);
    const octokit = await this.getOctokit();
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
      state: 'all',
      per_page: 25,
    });
    return response.data.map((pr) => {
      const isMerged = pr.merged_at != null;
      const status: PullRequestStatus = isMerged
        ? 'merged'
        : pr.state === 'closed'
          ? 'closed'
          : 'open';
      return {
        id: pr.html_url,
        identifier: `#${pr.number}`,
        nameWithOwner,
        provider: 'github' as const,
        url: pr.html_url,
        title: pr.title,
        status,
        author: pr.user ? { userName: pr.user.login, displayName: pr.user.login } : null,
        isDraft: pr.draft ?? false,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        metadata: {
          number: pr.number,
          headRefName: pr.head.ref,
          headRefOid: pr.head.sha,
          baseRefName: pr.base.ref,
          headRepository: pr.head.repo
            ? {
                nameWithOwner: pr.head.repo.full_name,
                url: pr.head.repo.html_url,
                owner: { login: pr.head.repo.owner.login },
              }
            : null,
          labels: (pr.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
          assignees: (pr.assignees ?? []).map((a) => ({
            login: a.login,
            avatarUrl: a.avatar_url,
          })),
          reviewDecision: null,
          reviewers: [],
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          mergeable: 'UNKNOWN' as const,
          mergeStateStatus: 'UNKNOWN' as const,
          body: pr.body ?? null,
        },
      };
    });
  }

  private mapToUnified(node: GqlPrNode, nameWithOwner: string): PullRequest {
    const status: PullRequestStatus =
      node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open';

    return {
      id: node.url,
      identifier: `#${node.number}`,
      nameWithOwner,
      provider: 'github',
      url: node.url,
      title: node.title,
      status,
      author: node.author ? { userName: node.author.login, displayName: node.author.login } : null,
      isDraft: node.isDraft,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      metadata: {
        number: node.number,
        headRefName: node.headRefName,
        headRefOid: node.headRefOid,
        baseRefName: node.baseRefName,
        headRepository: node.headRepository,
        labels: node.labels.nodes,
        assignees: node.assignees.nodes,
        reviewDecision: node.reviewDecision,
        reviewers: this.buildReviewers(node),
        additions: node.additions ?? 0,
        deletions: node.deletions ?? 0,
        changedFiles: node.changedFiles ?? 0,
        mergeable: node.mergeable ?? 'UNKNOWN',
        mergeStateStatus: node.mergeStateStatus ?? 'UNKNOWN',
        body: node.body ?? null,
      },
    };
  }
}

export const prService = new GitHubPullRequestServiceImpl(getOctokit);

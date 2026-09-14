import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import {
  createRequestScheduler,
  requestPriorities,
  createTokenBucketGate,
  type CreateRequestSchedulerOptions,
  type RateFeedback,
  type RateGate,
  type RequestScheduler,
} from '@emdash/shared/requests';
import { retry, retrySchedules, type RetrySchedule } from '@emdash/shared/scheduling';
import type { ContractClient } from '@emdash/wire/rpc';
import { Octokit } from '@octokit/rest';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import type {
  GitPlatformAuthContract,
  PullRequest,
  PullRequestCheck,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
  PullRequestUser,
} from '../../api';
import { isNetworkError, type PullRequestOperationErrorType } from './errors';
import type { Observed, PullRequestMetadata, PullRequestPage } from './observation';
import type { GitPlatformPullRequestRepository } from './providers/git-platform-provider';
import { mapApiError, mapGitHubAuthError } from './providers/github/github-provider-errors';
import {
  GET_PR_BY_NUMBER_QUERY,
  GET_PR_CHECK_RUNS_BY_URL_QUERY,
  SYNC_PRS_QUERY,
  OPEN_PRS_QUERY,
  PR_COLLECTIONS_QUERY,
} from './providers/github/queries';

const DEFAULT_REQUEST_CONCURRENCY = 3;
const DEFAULT_REQUEST_CAPACITY = 20;
const DEFAULT_REQUEST_REFILL_PER_SEC = 10;
const DEFAULT_REQUEST_RESERVE = 50;

const defaultRetrySchedule = retrySchedules.jitter(
  retrySchedules.exponential({
    initialMs: 1_000,
    maxMs: 30_000,
    maxRetries: 2,
  })
);

export type PullRequestEngineOptions = {
  githubAuth: ContractClient<GitPlatformAuthContract>;
  scope: Scope;
  logger: Logger;
  createOctokit?: (options: { token: string; baseUrl: string }) => Octokit;
  createScheduler?: (options: CreateRequestSchedulerOptions) => RequestScheduler;
  createRateGate?: (resource: GitHubRateResource) => RateGate;
  retrySchedule?: RetrySchedule;
};

type RequestLane = {
  scheduler: RequestScheduler;
  gates: Record<GitHubRateResource, RateGate>;
};

type GitHubRateResource = 'graphql' | 'rest';

type GitHubClient = {
  identity: string;
  octokit: Octokit;
  lane: RequestLane;
};

type GraphQlRateLimit = {
  cost: number;
  remaining: number;
  resetAt: string;
};

type RequestOptions = {
  priority: number;
  cost?: number;
  key?: string;
};

type OctokitHeaders = Record<string, string | number | undefined>;

type OctokitRequestOptions = {
  url?: string;
  request?: { signal?: AbortSignal };
};

type OctokitRequestHook = {
  before?(name: 'request', callback: (options: OctokitRequestOptions) => Promise<void>): void;
  after(
    name: 'request',
    callback: (response: { headers: OctokitHeaders }, options: OctokitRequestOptions) => void
  ): void;
  error(name: 'request', callback: (error: unknown, options: OctokitRequestOptions) => never): void;
};

type RepositoryRef = NonNullable<ReturnType<typeof parseRepositoryRef>>;

interface GqlUser {
  databaseId?: number;
  login: string;
  avatarUrl: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
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
  baseRefOid: string;
  commitCount?: { totalCount: number };
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: PullRequest['mergeableStatus'];
  mergeStateStatus: PullRequest['mergeStateStatus'];
  author: GqlUser | null;
  headRepository: { url: string } | null;
  baseRepository: { url: string } | null;
  labels: { nodes: Array<{ name: string; color: string }>; pageInfo?: PageInfo };
  assignees: { nodes: GqlUser[]; pageInfo?: PageInfo };
  reviewDecision: string | null;
  statusCheckRollup?: { state: NonNullable<PullRequest['checkSummary']> } | null;
}

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

type GqlCheckNode = GqlCheckRunNode | GqlStatusContextNode;
type OpenPrResponse = {
  repository: {
    pullRequests: {
      nodes: GqlPrNode[];
      totalCount?: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  rateLimit?: GraphQlRateLimit;
};

/** GitHub transport adapter: authenticated observations and mutations, never cache policy. */
export class PullRequestEngine {
  private readonly requestLanes = new Map<string, RequestLane>();

  constructor(private readonly options: PullRequestEngineOptions) {}

  async openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<GitPlatformPullRequestRepository, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    try {
      const github = await this.getOctokit(repository.data, signal);
      if (!github.success) return github;
      signal.throwIfAborted();
      const ref = repository.data;
      const client = github.data;
      return ok({
        identity: client.identity,
        repositoryUrl: ref.repositoryUrl,
        fetchOpenPage: (cursor, requestSignal, priority) =>
          this.fetchPage(ref, client, OPEN_PRS_QUERY, 'open', cursor, requestSignal, priority),
        fetchHistoryPage: (cursor, requestSignal, priority) =>
          this.fetchPage(ref, client, SYNC_PRS_QUERY, 'history', cursor, requestSignal, priority),
        fetchPullRequest: (number, requestSignal, priority) =>
          this.fetchPullRequest(ref, client, number, requestSignal, priority),
        fetchChecks: (number, requestSignal) =>
          this.fetchChecks(ref, client, number, requestSignal),
        fetchComments: (number, requestSignal) =>
          this.fetchComments(ref, client, number, requestSignal),
      });
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to access repository',
        'refresh_failed'
      );
    }
  }

  private async fetchPage(
    repository: RepositoryRef,
    github: GitHubClient,
    query: string,
    kind: 'open' | 'history',
    cursor: string | null,
    signal: AbortSignal,
    priority: number = requestPriorities.background
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>> {
    const fetchedAt = Date.now();
    const { lane, octokit } = github;
    try {
      const response = await this.request(
        lane,
        signal,
        { priority, key: `${kind}:${repository.repositoryUrl}:${cursor ?? ''}` },
        (requestSignal) =>
          octokit.graphql<OpenPrResponse>(query, {
            owner: repository.owner,
            repo: repository.repo,
            cursor,
            request: { signal: requestSignal },
          })
      );
      lane.gates.graphql.observe(graphQlRateFeedback(response.rateLimit));
      const page = response.repository.pullRequests;
      if (
        page.pageInfo.hasNextPage &&
        (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)
      ) {
        throw new Error('Incomplete PR inventory pagination');
      }
      const prs: PullRequestMetadata[] = [];
      for (const rawNode of page.nodes) {
        // Scheduler coalescing can share a response between callers; pagination must
        // never append into that shared response's connection arrays.
        const node = cloneNodeCollections(rawNode);
        await this.completeCollections(repository, github, node, signal, priority);
        prs.push(this.mapNode(repository.repositoryUrl, node));
      }
      signal.throwIfAborted();
      return ok({ fetchedAt, data: { prs, pageInfo: page.pageInfo, totalCount: page.totalCount } });
    } catch (error) {
      return this.handleError(error, repository, 'Unable to read pull requests', 'sync_failed');
    }
  }

  private async fetchPullRequest(
    repository: RepositoryRef,
    github: GitHubClient,
    number: number,
    signal: AbortSignal,
    priority: number = requestPriorities.interactive
  ): Promise<Result<Observed<PullRequestMetadata>, PullRequestError>> {
    const fetchedAt = Date.now();
    const { lane, octokit } = github;
    try {
      const response = await this.request(
        lane,
        signal,
        { priority, key: `pr:${repository.repositoryUrl}:${number}` },
        (requestSignal) =>
          octokit.graphql<{
            repository: { pullRequest: GqlPrNode | null };
            rateLimit?: GraphQlRateLimit;
          }>(GET_PR_BY_NUMBER_QUERY, {
            owner: repository.owner,
            repo: repository.repo,
            number,
            request: { signal: requestSignal },
          })
      );
      lane.gates.graphql.observe(graphQlRateFeedback(response.rateLimit));
      const rawNode = response.repository.pullRequest;
      if (!rawNode)
        return err({
          type: 'github_not_found_or_no_access',
          host: repository.host,
          message: `Pull request #${number} was not found`,
        });
      const node = cloneNodeCollections(rawNode);
      await this.completeCollections(repository, github, node, signal, priority);
      signal.throwIfAborted();
      return ok({ fetchedAt, data: this.mapNode(repository.repositoryUrl, node) });
    } catch (error) {
      return this.handleError(error, repository, 'Unable to read pull request', 'refresh_failed');
    }
  }

  private async fetchChecks(
    repository: RepositoryRef,
    github: GitHubClient,
    number: number,
    signal: AbortSignal
  ): Promise<
    Result<Observed<{ headRefOid: string; checks: PullRequestCheck[] }>, PullRequestError>
  > {
    const fetchedAt = Date.now();
    const { lane, octokit } = github;
    try {
      const nodes: GqlCheckNode[] = [];
      let cursor: string | null = null;
      let headRefOid: string | undefined;
      const visited = new Set<string>();
      for (;;) {
        const response: {
          repository: {
            pullRequest: {
              commits: {
                nodes: Array<{
                  commit: {
                    oid: string;
                    statusCheckRollup: {
                      contexts: { pageInfo: PageInfo; nodes: GqlCheckNode[] };
                    } | null;
                  };
                }>;
              };
            } | null;
          };
          rateLimit?: GraphQlRateLimit;
        } = await this.request(
          lane,
          signal,
          {
            priority: requestPriorities.interactive,
            key: `checks:${repository.repositoryUrl}:${number}:${cursor ?? ''}`,
          },
          (requestSignal) =>
            octokit.graphql(GET_PR_CHECK_RUNS_BY_URL_QUERY, {
              owner: repository.owner,
              repo: repository.repo,
              number,
              cursor,
              request: { signal: requestSignal },
            })
        );
        lane.gates.graphql.observe(graphQlRateFeedback(response.rateLimit));
        const commit = response.repository.pullRequest?.commits.nodes[0]?.commit;
        if (!commit?.oid) throw new Error('Pull request head was not returned');
        if (headRefOid !== undefined && commit.oid !== headRefOid) {
          throw new Error('The PR head changed while refreshing checks');
        }
        headRefOid = commit.oid;
        const contexts = commit.statusCheckRollup?.contexts;
        if (!contexts) break;
        nodes.push(...contexts.nodes);
        if (!contexts.pageInfo.hasNextPage) break;
        const next = contexts.pageInfo.endCursor;
        if (!next || visited.has(next)) throw new Error('Incomplete checks pagination');
        visited.add(next);
        cursor = next;
      }
      signal.throwIfAborted();
      const pullRequestUrl = `${repository.repositoryUrl}/pull/${number}`;
      return ok({
        fetchedAt,
        data: {
          headRefOid,
          checks: nodes.map((node, index) =>
            checkNodeToPullRequestCheck(node, pullRequestUrl, headRefOid, index)
          ),
        },
      });
    } catch (error) {
      return this.handleError(error, repository, 'Unable to read check runs', 'checks_failed');
    }
  }

  async createPullRequest(
    input: {
      repositoryUrl: string;
      headRepositoryUrl?: string;
      head: string;
      base: string;
      title: string;
      body?: string;
      draft: boolean;
    },
    signal: AbortSignal
  ): Promise<Result<{ url: string; number: number }, PullRequestError>> {
    const repository = this.parseRepository(input.repositoryUrl);
    if (!repository.success) return repository;
    if (input.headRepositoryUrl) {
      const head = parseRepositoryRef(input.headRepositoryUrl);
      if (head && head.host !== repository.data.host) {
        return err({
          type: 'cross_host_pr',
          baseHost: repository.data.host,
          headHost: head.host,
        });
      }
    }
    const github = await this.getOctokit(repository.data, signal);
    if (!github.success) return github;
    const { lane, octokit } = github.data;
    try {
      const response = await this.request(
        lane,
        signal,
        { priority: requestPriorities.interactive },
        (requestSignal) =>
          octokit.rest.pulls.create({
            owner: repository.data.owner,
            repo: repository.data.repo,
            head: input.head,
            base: input.base,
            title: input.title,
            body: input.body,
            draft: input.draft,
            request: { signal: requestSignal },
          })
      );
      return ok({ url: response.data.html_url, number: response.data.number });
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to create pull request',
        'create_failed'
      );
    }
  }

  async mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const github = await this.getOctokit(repository.data, signal);
    if (!github.success) return github;
    const { lane, octokit } = github.data;
    try {
      const response = await this.request(
        lane,
        signal,
        { priority: requestPriorities.interactive },
        (requestSignal) =>
          octokit.rest.pulls.merge({
            owner: repository.data.owner,
            repo: repository.data.repo,
            pull_number: number,
            merge_method: options.strategy,
            sha: options.commitHeadOid,
            request: { signal: requestSignal },
          })
      );
      return ok({ sha: response.data.sha ?? null, merged: response.data.merged });
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to merge pull request',
        'merge_failed'
      );
    }
  }

  async markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const github = await this.getOctokit(repository.data, signal);
    if (!github.success) return github;
    const { lane, octokit } = github.data;
    try {
      const response = await this.request(
        lane,
        signal,
        {
          priority: requestPriorities.interactive,
          key: `pr-node-id:${repository.data.repositoryUrl}:${number}`,
        },
        (requestSignal) =>
          octokit.rest.pulls.get({
            owner: repository.data.owner,
            repo: repository.data.repo,
            pull_number: number,
            request: { signal: requestSignal },
          })
      );
      await this.request(
        lane,
        signal,
        { priority: requestPriorities.interactive },
        (requestSignal) =>
          octokit.graphql(
            `mutation MarkReadyForReview($id: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $id }) {
              pullRequest { isDraft }
            }
          }`,
            { id: response.data.node_id, request: { signal: requestSignal } }
          )
      );
      return ok();
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to mark PR ready for review',
        'mark_ready_failed'
      );
    }
  }

  private async fetchComments(
    repository: RepositoryRef,
    github: GitHubClient,
    number: number,
    signal: AbortSignal
  ): Promise<Result<Observed<PullRequestComment[]>, PullRequestError>> {
    const fetchedAt = Date.now();
    try {
      // PR ETags do not validate the independent comment and review collections.
      const data = await this.fetchPullRequestComments(
        repository,
        github,
        `${repository.repositoryUrl}/pull/${number}`,
        number,
        signal
      );
      signal.throwIfAborted();
      return ok({ data, fetchedAt });
    } catch (error) {
      return this.handleError(
        error,
        repository,
        'Unable to read pull request comments',
        'comments_failed'
      );
    }
  }

  private async fetchPullRequestComments(
    repository: RepositoryRef,
    github: GitHubClient,
    pullRequestUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<PullRequestComment[]> {
    const { lane, octokit } = github;
    const [issueComments, reviewComments, reviews] = await Promise.all([
      this.request(
        lane,
        signal,
        {
          priority: requestPriorities.interactive,
          key: `comments:issue:${repository.repositoryUrl}:${number}`,
        },
        (requestSignal) =>
          octokit.paginate(octokit.rest.issues.listComments, {
            owner: repository.owner,
            repo: repository.repo,
            issue_number: number,
            per_page: 100,
            request: { signal: requestSignal },
          })
      ),
      this.request(
        lane,
        signal,
        {
          priority: requestPriorities.interactive,
          key: `comments:review-comments:${repository.repositoryUrl}:${number}`,
        },
        (requestSignal) =>
          octokit.paginate(octokit.rest.pulls.listReviewComments, {
            owner: repository.owner,
            repo: repository.repo,
            pull_number: number,
            per_page: 100,
            request: { signal: requestSignal },
          })
      ),
      this.request(
        lane,
        signal,
        {
          priority: requestPriorities.interactive,
          key: `comments:reviews:${repository.repositoryUrl}:${number}`,
        },
        (requestSignal) =>
          octokit.paginate(octokit.rest.pulls.listReviews, {
            owner: repository.owner,
            repo: repository.repo,
            pull_number: number,
            per_page: 100,
            request: { signal: requestSignal },
          })
      ),
    ]);
    return [
      ...issueComments.map((comment) => ({
        id: `issue-comment:${comment.id}`,
        pullRequestUrl,
        kind: 'issue' as const,
        body: comment.body ?? '',
        url: comment.html_url,
        author: comment.user ? restUserToPullRequestUser(comment.user, repository.host) : null,
        path: null,
        line: null,
        isResolved: false,
        isOutdated: false,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
      })),
      ...reviews.flatMap((review): PullRequestComment[] => {
        if (!review.body?.trim() || !review.submitted_at) return [];
        return [
          {
            id: `review:${review.id}`,
            pullRequestUrl,
            kind: 'review',
            body: review.body,
            url: review.html_url,
            author: review.user ? restUserToPullRequestUser(review.user, repository.host) : null,
            path: null,
            line: null,
            isResolved: false,
            isOutdated: false,
            createdAt: review.submitted_at,
            updatedAt: review.submitted_at,
          },
        ];
      }),
      ...reviewComments.map((comment) => ({
        id: `review-comment:${comment.id}`,
        pullRequestUrl,
        kind: 'review' as const,
        body: comment.body ?? '',
        url: comment.html_url,
        author: comment.user ? restUserToPullRequestUser(comment.user, repository.host) : null,
        path: comment.path ?? null,
        line: comment.line ?? comment.original_line ?? null,
        isResolved: false,
        isOutdated: comment.position == null,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
      })),
    ];
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const github = await this.getOctokit(repository.data, signal);
    if (!github.success) return github;
    const { lane, octokit } = github.data;
    try {
      const files = await this.request(
        lane,
        signal,
        {
          priority: requestPriorities.interactive,
          key: `files:${repository.data.repositoryUrl}:${number}`,
        },
        (requestSignal) =>
          octokit.paginate(octokit.rest.pulls.listFiles, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            pull_number: number,
            per_page: 100,
            request: { signal: requestSignal },
          })
      );
      return ok(
        files.map((file) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        }))
      );
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to get pull request files',
        'files_failed'
      );
    }
  }

  private async completeCollections(
    repository: RepositoryRef,
    github: GitHubClient,
    node: GqlPrNode,
    signal: AbortSignal,
    priority: number
  ): Promise<void> {
    let labels = node.labels.pageInfo;
    let assignees = node.assignees.pageInfo;
    const labelCursors = new Set<string>();
    const assigneeCursors = new Set<string>();
    while (labels?.hasNextPage || assignees?.hasNextPage) {
      if (
        (labels?.hasNextPage && !labels.endCursor) ||
        (assignees?.hasNextPage && !assignees.endCursor)
      )
        throw new Error('Incomplete PR metadata pagination');
      if (labels?.hasNextPage && labels.endCursor) {
        if (labelCursors.has(labels.endCursor)) throw new Error('Repeated label cursor');
        labelCursors.add(labels.endCursor);
      }
      if (assignees?.hasNextPage && assignees.endCursor) {
        if (assigneeCursors.has(assignees.endCursor)) throw new Error('Repeated assignee cursor');
        assigneeCursors.add(assignees.endCursor);
      }
      const response: {
        repository: { pullRequest: Pick<GqlPrNode, 'labels' | 'assignees'> };
        rateLimit?: GraphQlRateLimit;
      } = await this.request(
        github.lane,
        signal,
        {
          priority,
          key: `collections:${repository.repositoryUrl}:${node.number}:${labels?.endCursor}:${assignees?.endCursor}`,
        },
        (requestSignal) =>
          github.octokit.graphql(PR_COLLECTIONS_QUERY, {
            owner: repository.owner,
            repo: repository.repo,
            number: node.number,
            labelsCursor: labels?.endCursor ?? null,
            assigneesCursor: assignees?.endCursor ?? null,
            request: { signal: requestSignal },
          })
      );
      github.lane.gates.graphql.observe(graphQlRateFeedback(response.rateLimit));
      const page = response.repository.pullRequest;
      if (labels?.hasNextPage) {
        if (!page.labels.pageInfo) throw new Error('Missing label pagination');
        node.labels.nodes.push(...page.labels.nodes);
        labels = page.labels.pageInfo;
      }
      if (assignees?.hasNextPage) {
        if (!page.assignees.pageInfo) throw new Error('Missing assignee pagination');
        node.assignees.nodes.push(...page.assignees.nodes);
        assignees = page.assignees.pageInfo;
      }
    }
    signal.throwIfAborted();
  }

  private mapNode(repositoryUrl: string, node: GqlPrNode): PullRequestMetadata {
    const baseRepository =
      parseRepositoryRef(node.baseRepository?.url ?? '') ?? parseRepositoryRef(repositoryUrl);
    const baseRepositoryUrl = baseRepository?.repositoryUrl ?? repositoryUrl;
    const repositoryHost = baseRepository?.host ?? 'unknown';
    const headRepositoryUrl =
      parseRepositoryRef(node.headRepository?.url ?? '')?.repositoryUrl ?? repositoryUrl;
    return {
      url: node.url,
      provider: 'github',
      repositoryUrl: baseRepositoryUrl,
      baseRefName: node.baseRefName,
      baseRefOid: node.baseRefOid,
      headRepositoryUrl,
      headRefName: node.headRefName,
      headRefOid: node.headRefOid,
      identifier: `#${node.number}`,
      title: node.title,
      description: node.body,
      status: node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open',
      isDraft: node.isDraft,
      additions: node.additions,
      deletions: node.deletions,
      changedFiles: node.changedFiles,
      commitCount: node.commitCount?.totalCount ?? null,
      mergeableStatus: node.mergeable,
      mergeStateStatus: node.mergeStateStatus,
      reviewDecision: node.reviewDecision,
      checkSummary: node.statusCheckRollup?.state ?? null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      author: node.author ? gqlUserToPullRequestUser(node.author, repositoryHost) : null,
      labels: node.labels.nodes.map((label) => ({ name: label.name, color: label.color ?? null })),
      assignees: node.assignees.nodes.map((user) => gqlUserToPullRequestUser(user, repositoryHost)),
    };
  }

  private async getOctokit(
    repository: RepositoryRef,
    signal: AbortSignal
  ): Promise<Result<GitHubClient, PullRequestError>> {
    // Identity is a per-request runtime parameter (spec: github-git-settings §8):
    // the desktop resolves "as whom" through the blessed resolver on every call,
    // so account changes apply on the very next sync with no event plumbing.
    const auth = await this.options.githubAuth.resolveAuth(
      { repositoryUrl: repository.repositoryUrl },
      { signal }
    );
    if (!auth.success) return err(mapGitHubAuthError(auth.error));
    const lane = this.getRequestLane(repository.host, auth.data.accountId);
    const octokit =
      this.options.createOctokit?.({
        token: auth.data.token,
        baseUrl: auth.data.apiBaseUrl,
      }) ??
      new Octokit({
        auth: auth.data.token,
        baseUrl: auth.data.apiBaseUrl,
        log: {
          debug: () => this.options.logger.debug('Octokit request'),
          info: () => this.options.logger.debug('Octokit request completed'),
          warn: () => this.options.logger.warn('Octokit request warning'),
          error: () => this.options.logger.warn('Octokit request failed'),
        },
      });
    this.observeOctokitRateLimits(octokit, lane);
    return ok({ octokit, lane, identity: `${repository.host}\u0000${auth.data.accountId ?? ''}` });
  }

  private parseRepository(repositoryUrl: string): Result<RepositoryRef, PullRequestError> {
    const repository = parseRepositoryRef(repositoryUrl);
    return repository ? ok(repository) : err({ type: 'invalid_repository', input: repositoryUrl });
  }

  private async request<T>(
    lane: RequestLane,
    signal: AbortSignal,
    options: RequestOptions,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return await retry(
      async () =>
        await lane.scheduler.submit(
          {
            priority: options.priority,
            cost: options.cost ?? 0,
            key: options.key,
            run: operation,
          },
          { signal }
        ),
      {
        signal,
        schedule: this.options.retrySchedule ?? defaultRetrySchedule,
        shouldRetry: isRetryableRequestError,
      }
    );
  }

  private getRequestLane(host: string, accountId: string | undefined): RequestLane {
    const key = `${host}\u0000${accountId ?? 'default'}`;
    const existing = this.requestLanes.get(key);
    if (existing) return existing;
    const gates = {
      graphql: this.createRateGate('graphql'),
      rest: this.createRateGate('rest'),
    };
    const scheduler = (this.options.createScheduler ?? createRequestScheduler)({
      scope: this.options.scope,
      maxConcurrency: DEFAULT_REQUEST_CONCURRENCY,
      label: `github:${host}:${accountId ?? 'default'}`,
    });
    const lane = { gates, scheduler };
    this.requestLanes.set(key, lane);
    return lane;
  }

  private createRateGate(resource: GitHubRateResource): RateGate {
    return (
      this.options.createRateGate?.(resource) ??
      createTokenBucketGate({
        capacity: DEFAULT_REQUEST_CAPACITY,
        refillPerSec: DEFAULT_REQUEST_REFILL_PER_SEC,
        reserve: DEFAULT_REQUEST_RESERVE,
      })
    );
  }

  private observeOctokitRateLimits(octokit: Octokit, lane: RequestLane): void {
    const hook = (octokit as unknown as { hook?: OctokitRequestHook }).hook;
    if (!hook) return;
    hook.before?.('request', async (options) => {
      const resource = rateResourceForRequest(options);
      await lane.gates[resource].acquire(
        resource === 'graphql' ? 0 : 1,
        options.request?.signal ?? this.options.scope.signal
      );
    });
    hook.after('request', (response, options) => {
      const resource = rateResourceForRequest(options, response.headers);
      lane.gates[resource].observe(rateFeedbackFromHeaders(response.headers));
    });
    hook.error('request', (error, options) => {
      const headers = responseHeadersFromError(error);
      const resource = rateResourceForRequest(options, headers);
      lane.gates[resource].observe(rateFeedbackFromHeaders(headers));
      throw error;
    });
  }

  private handleError<T>(
    error: unknown,
    repository: RepositoryRef,
    fallback: string,
    operationType: PullRequestOperationErrorType
  ): Result<T, PullRequestError> {
    return err(
      mapApiError(error, fallback, repository.host, repository.nameWithOwner, operationType)
    );
  }
}

function cloneNodeCollections(node: GqlPrNode): GqlPrNode {
  return {
    ...node,
    labels: { ...node.labels, nodes: [...node.labels.nodes] },
    assignees: { ...node.assignees, nodes: [...node.assignees.nodes] },
  };
}

function gqlUserToPullRequestUser(user: GqlUser, host: string): PullRequestUser {
  return {
    userId: user.databaseId == null ? `${host}:login:${user.login}` : `${host}:${user.databaseId}`,
    userName: user.login,
    displayName: user.login,
    avatarUrl: user.avatarUrl || null,
    url: user.url ?? null,
    userCreatedAt: user.createdAt ?? null,
    userUpdatedAt: user.updatedAt ?? null,
  };
}

function restUserToPullRequestUser(
  user: {
    id: number;
    login: string;
    avatar_url: string;
    html_url: string;
  },
  host: string
): PullRequestUser {
  return {
    userId: `${host}:${user.id}`,
    userName: user.login,
    displayName: user.login,
    avatarUrl: user.avatar_url || null,
    url: user.html_url,
    userCreatedAt: null,
    userUpdatedAt: null,
  };
}

function checkNodeToPullRequestCheck(
  node: GqlCheckNode,
  pullRequestUrl: string,
  headRefOid: string,
  index: number
): PullRequestCheck {
  if (node.__typename === 'CheckRun') {
    return {
      id: `${headRefOid}:${index}:${node.name}`,
      pullRequestUrl,
      commitSha: headRefOid,
      name: node.name,
      status: node.status,
      conclusion: node.conclusion ?? 'NEUTRAL',
      detailsUrl: node.detailsUrl,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      workflowName: node.checkSuite?.workflowRun?.workflow.name ?? null,
      appName: node.checkSuite?.app?.name ?? null,
      appLogoUrl: node.checkSuite?.app?.logoUrl ?? null,
    };
  }
  return {
    id: `${headRefOid}:${index}:${node.context}`,
    pullRequestUrl,
    commitSha: headRefOid,
    name: node.context,
    status: node.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
    conclusion:
      node.state === 'SUCCESS'
        ? 'SUCCESS'
        : node.state === 'FAILURE' || node.state === 'ERROR'
          ? 'FAILURE'
          : 'NEUTRAL',
    detailsUrl: node.targetUrl,
    startedAt: node.createdAt,
    completedAt: node.state === 'PENDING' ? null : node.createdAt,
    workflowName: null,
    appName: null,
    appLogoUrl: null,
  };
}

function isRetryableRequestError(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  return status === 429 || (status !== undefined && status >= 500) || isNetworkError(error);
}

function graphQlRateFeedback(rateLimit: GraphQlRateLimit | undefined): RateFeedback {
  if (!rateLimit) return {};
  const resetAtMs = Date.parse(rateLimit.resetAt);
  return {
    cost: rateLimit.cost,
    remaining: rateLimit.remaining,
    resetAtMs: Number.isFinite(resetAtMs) ? resetAtMs : undefined,
  };
}

function responseHeadersFromError(error: unknown): OctokitHeaders | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  return (error as { response?: { headers?: OctokitHeaders } }).response?.headers;
}

function rateResourceForRequest(
  options: OctokitRequestOptions,
  headers?: OctokitHeaders
): GitHubRateResource {
  const resource = String(headers?.['x-ratelimit-resource'] ?? '').toLowerCase();
  if (resource === 'graphql') return 'graphql';
  if (resource) return 'rest';
  return options.url?.includes('/graphql') ? 'graphql' : 'rest';
}

function rateFeedbackFromHeaders(headers: OctokitHeaders | undefined): RateFeedback {
  if (!headers) return {};
  const remaining = parseFiniteHeader(headers, 'x-ratelimit-remaining');
  const resetSeconds = parseFiniteHeader(headers, 'x-ratelimit-reset');
  const retryAfter = headers['retry-after'];
  return {
    remaining,
    resetAtMs: resetSeconds === undefined ? undefined : resetSeconds * 1_000,
    retryAfterMs: retryAfterMs(retryAfter),
  };
}

function parseFiniteHeader(headers: OctokitHeaders, name: string): number | undefined {
  const value = Number(headers[name]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function retryAfterMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

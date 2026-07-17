import type { Logger } from '@emdash/shared/logger';
import { err, ok, type Result } from '@emdash/shared/result';
import type { ContractClient } from '@emdash/wire/api';
import { Octokit } from '@octokit/rest';
import { parseRepositoryRef } from '@shared/repository-ref';
import type {
  GitHubAuthContract,
  PullRequest,
  PullRequestCheck,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
  PullRequestUser,
  SyncState,
} from '../../api';
import type { PullRequestStore, SyncCursor } from '../store';
import {
  isAbortError,
  mapApiError,
  mapAuthError,
  type PullRequestOperationErrorType,
} from './errors';
import {
  GET_PR_BY_NUMBER_QUERY,
  GET_PR_CHECK_RUNS_BY_URL_QUERY,
  INCREMENTAL_SYNC_PRS_QUERY,
  SYNC_PRS_QUERY,
} from './queries';
import { RateLimiter, throwIfAborted, withRetry } from './retry';

const DEFAULT_MAX_SYNC_COUNT = 300;
const DEFAULT_ARCHIVE_AGE_MONTHS = 6;

export type PullRequestEngineOptions = {
  store: PullRequestStore;
  githubAuth: ContractClient<GitHubAuthContract>;
  logger: Logger;
  maxSyncCount?: number;
  archiveAgeMonths?: number;
  onSyncState?: (repositoryUrl: string, state: SyncState) => void;
  createOctokit?: (options: { token: string; baseUrl: string }) => Octokit;
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
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: GqlUser[] };
  reviewDecision: string | null;
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

export class PullRequestEngine {
  private readonly rateLimiter = new RateLimiter();

  constructor(private readonly options: PullRequestEngineOptions) {}

  async sync(repositoryUrl: string, signal: AbortSignal): Promise<Result<void, PullRequestError>> {
    const fullCursor = this.options.store.getCursor(repositoryUrl, 'full');
    return fullCursor?.done
      ? await this.runIncrementalSync(repositoryUrl, signal)
      : await this.runFullSync(repositoryUrl, signal);
  }

  async forceFullSync(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    this.options.store.clearCursors(repositoryUrl);
    return await this.runFullSync(repositoryUrl, signal);
  }

  async syncSingle(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal,
    options: { emit?: boolean } = {}
  ): Promise<Result<PullRequest, PullRequestError>> {
    const emitProgress = options.emit !== false;
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) {
      if (emitProgress) {
        this.emit(repositoryUrl, {
          phase: 'error',
          kind: 'single',
          error: octokit.error,
        });
      }
      return octokit;
    }
    if (emitProgress) {
      this.emit(repositoryUrl, { phase: 'running', kind: 'single', synced: 0 });
    }
    try {
      const response = await this.request(signal, () =>
        octokit.data.graphql<{ repository: { pullRequest: GqlPrNode | null } }>(
          GET_PR_BY_NUMBER_QUERY,
          {
            owner: repository.data.owner,
            repo: repository.data.repo,
            number,
            request: { signal },
          }
        )
      );
      const node = response.repository.pullRequest;
      if (!node) {
        const notFound: PullRequestError = {
          type: 'github_not_found_or_no_access',
          host: repository.data.host,
          message: `Pull request #${number} was not found`,
        };
        if (emitProgress) {
          this.emit(repositoryUrl, {
            phase: 'error',
            kind: 'single',
            error: notFound,
          });
        }
        return err(notFound);
      }
      const pr = this.saveNode(repositoryUrl, node);
      this.emit(repositoryUrl, {
        phase: 'idle',
        kind: 'single',
        synced: 1,
        lastSyncedAt: Date.now(),
      });
      return ok(pr);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        if (emitProgress) {
          this.emit(repositoryUrl, { phase: 'idle', kind: 'single' });
        }
        return err({ type: 'refresh_failed', message: 'Operation cancelled' });
      }
      const result = this.handleError<PullRequest>(
        error,
        repository.data,
        'Unable to refresh pull request',
        'refresh_failed'
      );
      if (!result.success && emitProgress) {
        this.emit(repositoryUrl, {
          phase: 'error',
          kind: 'single',
          error: result.error,
        });
      }
      return result;
    }
  }

  async syncChecks(
    repositoryUrl: string,
    pullRequestUrl: string,
    headRefOid: string,
    signal: AbortSignal
  ): Promise<Result<boolean, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const identity = this.options.store.getPullRequestIdentity(pullRequestUrl);
    const number = identity?.identifier
      ? Number.parseInt(identity.identifier.replace('#', ''), 10)
      : Number.NaN;
    if (!Number.isFinite(number)) return ok(false);
    if (this.options.store.getChecksCommitSha(pullRequestUrl) !== headRefOid) {
      this.options.store.clearChecks(pullRequestUrl);
    }
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    try {
      const nodes: GqlCheckNode[] = [];
      let cursor: string | undefined;
      for (;;) {
        const response = await this.request(signal, () =>
          octokit.data.graphql<{
            repository: {
              pullRequest: {
                commits: {
                  nodes: Array<{
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          pageInfo: { hasNextPage: boolean; endCursor: string | null };
                          nodes: GqlCheckNode[];
                        };
                      } | null;
                    };
                  }>;
                };
              } | null;
            };
          }>(GET_PR_CHECK_RUNS_BY_URL_QUERY, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            number,
            cursor: cursor ?? null,
            request: { signal },
          })
        );
        const contexts =
          response.repository.pullRequest?.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
        if (!contexts) break;
        nodes.push(...contexts.nodes);
        if (!contexts.pageInfo.hasNextPage) break;
        cursor = contexts.pageInfo.endCursor ?? undefined;
      }
      this.options.store.replaceChecks(
        pullRequestUrl,
        nodes.map((node, index) =>
          checkNodeToPullRequestCheck(node, pullRequestUrl, headRefOid, index)
        )
      );
      this.emit(repositoryUrl, {
        phase: 'idle',
        kind: 'single',
        lastSyncedAt: Date.now(),
      });
      return ok(
        nodes.some((node) =>
          node.__typename === 'CheckRun'
            ? ['IN_PROGRESS', 'QUEUED', 'WAITING', 'PENDING'].includes(node.status)
            : node.state === 'PENDING'
        )
      );
    } catch (error) {
      return this.handleError(error, repository.data, 'Unable to sync check runs', 'checks_failed');
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
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    try {
      const response = await this.request(signal, () =>
        octokit.data.rest.pulls.create({
          owner: repository.data.owner,
          repo: repository.data.repo,
          head: input.head,
          base: input.base,
          title: input.title,
          body: input.body,
          draft: input.draft,
          request: { signal },
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
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    try {
      const response = await this.request(signal, () =>
        octokit.data.rest.pulls.merge({
          owner: repository.data.owner,
          repo: repository.data.repo,
          pull_number: number,
          merge_method: options.strategy,
          sha: options.commitHeadOid,
          request: { signal },
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
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    try {
      const response = await this.request(signal, () =>
        octokit.data.rest.pulls.get({
          owner: repository.data.owner,
          repo: repository.data.repo,
          pull_number: number,
          request: { signal },
        })
      );
      await this.request(signal, () =>
        octokit.data.graphql(
          `mutation MarkReadyForReview($id: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $id }) {
              pullRequest { isDraft }
            }
          }`,
          { id: response.data.node_id, request: { signal } }
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

  async getPullRequestComments(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestComment[], PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    const pullRequestUrl = `${repository.data.repositoryUrl}/pull/${number}`;
    try {
      const [issueComments, reviewComments, reviews] = await Promise.all([
        this.request(signal, () =>
          octokit.data.paginate(octokit.data.rest.issues.listComments, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            issue_number: number,
            per_page: 100,
            request: { signal },
          })
        ),
        this.request(signal, () =>
          octokit.data.paginate(octokit.data.rest.pulls.listReviewComments, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            pull_number: number,
            per_page: 100,
            request: { signal },
          })
        ),
        this.request(signal, () =>
          octokit.data.paginate(octokit.data.rest.pulls.listReviews, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            pull_number: number,
            per_page: 100,
            request: { signal },
          })
        ),
      ]);
      return ok([
        ...issueComments.map((comment) => ({
          id: `issue-comment:${comment.id}`,
          pullRequestUrl,
          kind: 'issue' as const,
          body: comment.body ?? '',
          url: comment.html_url,
          author: comment.user
            ? restUserToPullRequestUser(comment.user, repository.data.host)
            : null,
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
              author: review.user
                ? restUserToPullRequestUser(review.user, repository.data.host)
                : null,
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
          author: comment.user
            ? restUserToPullRequestUser(comment.user, repository.data.host)
            : null,
          path: comment.path ?? null,
          line: comment.line ?? comment.original_line ?? null,
          isResolved: false,
          isOutdated: comment.position == null,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        })),
      ]);
    } catch (error) {
      return this.handleError(
        error,
        repository.data,
        'Unable to get pull request comments',
        'comments_failed'
      );
    }
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) return octokit;
    try {
      const files = await this.request(signal, () =>
        octokit.data.paginate(octokit.data.rest.pulls.listFiles, {
          owner: repository.data.owner,
          repo: repository.data.repo,
          pull_number: number,
          per_page: 100,
          request: { signal },
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

  private async runFullSync(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) {
      this.emit(repositoryUrl, {
        phase: 'error',
        kind: 'full',
        error: octokit.error,
      });
      return octokit;
    }
    const existing = this.options.store.getCursor(repositoryUrl, 'full');
    let pageCursor = existing?.done ? undefined : existing?.pageCursor;
    let synced = 0;
    this.emit(repositoryUrl, { phase: 'running', kind: 'full', synced: 0 });
    try {
      for (;;) {
        const response = await this.request(signal, () =>
          octokit.data.graphql<{
            repository: {
              pullRequests: {
                totalCount: number;
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: GqlPrNode[];
              };
            };
          }>(SYNC_PRS_QUERY, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            cursor: pageCursor ?? null,
            request: { signal },
          })
        );
        const { nodes, pageInfo, totalCount } = response.repository.pullRequests;
        for (const node of nodes) this.saveNode(repositoryUrl, node);
        synced += nodes.length;
        const done =
          !pageInfo.hasNextPage || synced >= (this.options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT);
        const cursor: SyncCursor = {
          lastUpdatedAt:
            this.options.store.getNewestPullRequestUpdatedAt(repositoryUrl) ??
            existing?.lastUpdatedAt ??
            new Date().toISOString(),
          pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
          done,
        };
        this.options.store.setCursor(repositoryUrl, 'full', cursor);
        this.emit(repositoryUrl, {
          phase: 'running',
          kind: 'full',
          synced,
          total: Math.min(totalCount, this.options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT),
        });
        if (done) break;
        pageCursor = pageInfo.endCursor ?? undefined;
      }
      this.archiveOld(repositoryUrl);
      this.emit(repositoryUrl, {
        phase: 'idle',
        kind: 'full',
        synced,
        lastSyncedAt: Date.now(),
      });
      return ok();
    } catch (error) {
      return this.handleSyncError(error, repositoryUrl, repository.data, 'full', signal);
    }
  }

  private async runIncrementalSync(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    const repository = this.parseRepository(repositoryUrl);
    if (!repository.success) return repository;
    const octokit = await this.getOctokit(repository.data, signal);
    if (!octokit.success) {
      this.emit(repositoryUrl, {
        phase: 'error',
        kind: 'incremental',
        error: octokit.error,
      });
      return octokit;
    }
    const fullCursor = this.options.store.getCursor(repositoryUrl, 'full');
    const existing = this.options.store.getCursor(repositoryUrl, 'incremental');
    const boundary =
      existing?.lastUpdatedAt ?? fullCursor?.lastUpdatedAt ?? new Date(0).toISOString();
    let pageCursor = existing?.done ? undefined : existing?.pageCursor;
    let synced = 0;
    this.emit(repositoryUrl, { phase: 'running', kind: 'incremental', synced: 0 });
    try {
      for (;;) {
        const response = await this.request(signal, () =>
          octokit.data.graphql<{
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: GqlPrNode[];
              };
            };
          }>(INCREMENTAL_SYNC_PRS_QUERY, {
            owner: repository.data.owner,
            repo: repository.data.repo,
            cursor: pageCursor ?? null,
            request: { signal },
          })
        );
        const { nodes, pageInfo } = response.repository.pullRequests;
        const batch = nodes.filter((node) => node.updatedAt >= boundary);
        const reachedBoundary = batch.length !== nodes.length;
        for (const node of batch) this.saveNode(repositoryUrl, node);
        synced += batch.length;
        if (synced >= (this.options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT)) {
          // The repository is too far behind for an incremental update; the next sync rebuilds it.
          this.options.store.clearCursors(repositoryUrl);
          break;
        }
        const done = reachedBoundary || !pageInfo.hasNextPage;
        this.options.store.setCursor(repositoryUrl, 'incremental', {
          lastUpdatedAt: done
            ? (this.options.store.getNewestPullRequestUpdatedAt(repositoryUrl) ?? boundary)
            : boundary,
          pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
          done,
        });
        this.emit(repositoryUrl, { phase: 'running', kind: 'incremental', synced });
        if (done) break;
        pageCursor = pageInfo.endCursor ?? undefined;
      }
      this.emit(repositoryUrl, {
        phase: 'idle',
        kind: 'incremental',
        synced,
        lastSyncedAt: Date.now(),
      });
      return ok();
    } catch (error) {
      return this.handleSyncError(error, repositoryUrl, repository.data, 'incremental', signal);
    }
  }

  private saveNode(repositoryUrl: string, node: GqlPrNode): PullRequest {
    const previous = this.options.store.getPullRequestByUrl(node.url);
    const baseRepository =
      parseRepositoryRef(node.baseRepository?.url ?? '') ?? parseRepositoryRef(repositoryUrl);
    const baseRepositoryUrl = baseRepository?.repositoryUrl ?? repositoryUrl;
    const repositoryHost = baseRepository?.host ?? 'unknown';
    const headRepositoryUrl =
      parseRepositoryRef(node.headRepository?.url ?? '')?.repositoryUrl ?? repositoryUrl;
    return this.options.store.savePullRequest({
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
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      author: node.author ? gqlUserToPullRequestUser(node.author, repositoryHost) : null,
      labels: node.labels.nodes.map((label) => ({ name: label.name, color: label.color ?? null })),
      assignees: node.assignees.nodes.map((user) => gqlUserToPullRequestUser(user, repositoryHost)),
      checks: previous?.checks ?? [],
    });
  }

  private archiveOld(repositoryUrl: string): void {
    const cutoff = new Date();
    cutoff.setMonth(
      cutoff.getMonth() - (this.options.archiveAgeMonths ?? DEFAULT_ARCHIVE_AGE_MONTHS)
    );
    this.options.store.archiveOldPullRequests(repositoryUrl, cutoff.toISOString());
  }

  private async getOctokit(
    repository: RepositoryRef,
    signal: AbortSignal
  ): Promise<Result<Octokit, PullRequestError>> {
    const registered = this.options.store.getRegisteredRepository(repository.repositoryUrl);
    if (!registered) {
      return err({
        type: 'repository_not_registered',
        repositoryUrl: repository.repositoryUrl,
      });
    }
    const auth = await this.options.githubAuth.resolveAuth(
      { host: repository.host, accountId: registered.accountId },
      { signal }
    );
    if (!auth.success) return err(mapAuthError(auth.error));
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
    return ok(octokit);
  }

  private parseRepository(repositoryUrl: string): Result<RepositoryRef, PullRequestError> {
    const repository = parseRepositoryRef(repositoryUrl);
    return repository ? ok(repository) : err({ type: 'invalid_repository', input: repositoryUrl });
  }

  private async request<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return await withRetry(
      async () => {
        throwIfAborted(signal);
        await this.rateLimiter.acquire(signal);
        return await operation();
      },
      { signal }
    );
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

  private handleSyncError(
    error: unknown,
    repositoryUrl: string,
    repository: RepositoryRef,
    kind: 'full' | 'incremental',
    signal: AbortSignal
  ): Result<void, PullRequestError> {
    if (signal.aborted || isAbortError(error)) {
      this.emit(repositoryUrl, { phase: 'idle', kind });
      return err({ type: 'sync_failed', message: 'Pull request sync cancelled' });
    }
    const mapped = mapApiError(
      error,
      'Unable to sync pull requests',
      repository.host,
      repository.nameWithOwner
    );
    this.options.logger.warn('Pull request sync failed', {
      repositoryUrl,
      error: mapped,
    });
    this.emit(repositoryUrl, {
      phase: 'error',
      kind,
      error: mapped,
    });
    return err(mapped);
  }

  private emit(repositoryUrl: string, state: SyncState): void {
    this.options.onSyncState?.(repositoryUrl, state);
  }
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

import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { Octokit } from '@octokit/rest';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import type { GitHubApiAuthError } from '@main/core/github/services/github-api-auth-errors';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import {
  GET_PR_BY_NUMBER_QUERY,
  GET_PR_CHECK_RUNS_BY_URL_QUERY,
  INCREMENTAL_SYNC_PRS_QUERY,
  SYNC_PRS_QUERY,
} from '@main/core/github/services/pr-queries';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import {
  projectRemotes,
  pullRequestAssignees,
  pullRequestChecks,
  pullRequestLabels,
  pullRequests,
  pullRequestUsers,
} from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/core/pull-requests/prEvents';
import type {
  MergeableState,
  MergeStateStatus,
  PrSyncProgress,
  PullRequest,
  PullRequestComment,
  PullRequestFile,
  PullRequestMergeOptions,
  PullRequestStatus,
  PullRequestUser,
} from '@shared/core/pull-requests/pull-requests';
import { parseRepositoryRef, parseRepositoryRefResult } from '@shared/repository-ref';
import {
  isPrSyncHostUnreachable,
  prSyncEngineErrorMessage,
  toPrApiError,
  type PrSyncEngineError,
} from './pr-sync-errors';
import { assemblePullRequest } from './pr-utils';

const PR_SYNC_MAX_COUNT = 300;
const PR_ARCHIVE_AGE_MONTHS = 6;

type RepositorySyncResult = Result<void, PrSyncEngineError>;

type FullSyncCursor = {
  /** The `updatedAt` of the last PR we have seen (pagination cursor). */
  lastUpdatedAt: string;
  /** true once we have reached the count limit or the beginning of history. */
  done: boolean;
  /** GraphQL page cursor from the last completed page. */
  pageCursor?: string;
};

type IncrementalSyncCursor = {
  /** We only fetch PRs updated after this timestamp on each incremental sync. */
  lastUpdatedAt: string;
  /** GraphQL page cursor for resuming mid-page. */
  pageCursor?: string;
  done: boolean;
};

type PrKvSchema = {
  [key: string]: FullSyncCursor | IncrementalSyncCursor | string;
};

type PrSyncAuthContext = Pick<GitHubApiAuthContext, 'accountId'>;

function authContextKey(authContext: PrSyncAuthContext = {}): string {
  return authContext.accountId?.trim() || 'default';
}

function syncCancelledError(): PrSyncEngineError {
  return {
    type: 'sync_cancelled',
    message: 'Pull request sync was cancelled.',
  };
}

// ---------------------------------------------------------------------------
// GQL node shapes
// ---------------------------------------------------------------------------

interface GqlUser {
  databaseId?: number; // absent for Mannequin actors
  login: string;
  avatarUrl: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

function actorUserId(actor: GqlUser): string {
  return actor.databaseId != null ? String(actor.databaseId) : `login:${actor.login}`;
}

function restUserToPullRequestUser(user: {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
}): PullRequestUser {
  return {
    userId: String(user.id),
    userName: user.login,
    displayName: user.login,
    avatarUrl: user.avatar_url || null,
    url: user.html_url,
    userCreatedAt: null,
    userUpdatedAt: null,
  };
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
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus | null;
  author: GqlUser | null;
  headRepository: {
    nameWithOwner: string;
    url: string;
    owner: { login: string };
  } | null;
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

// ---------------------------------------------------------------------------
// PrSyncEngine
// ---------------------------------------------------------------------------

export class PrSyncEngine {
  private readonly kv = new KV<PrKvSchema>('pr');

  // Per-repository in-flight promise + AbortController
  private readonly _inflight = new Map<string, Promise<RepositorySyncResult>>();
  private readonly _controllers = new Map<string, AbortController>();
  // Per-operation deduplication for single-PR and check-run syncs
  private readonly _singleInflight = new Map<
    string,
    Promise<Result<PullRequest | null, PrSyncEngineError>>
  >();
  private readonly _checksInflight = new Map<string, Promise<Result<boolean, PrSyncEngineError>>>();

  constructor(
    private readonly getOctokit: (
      host: string,
      context?: PrSyncAuthContext
    ) => Promise<Result<Octokit, GitHubApiAuthError>>
  ) {}

  // ── Public sync API ────────────────────────────────────────────────────────

  /**
   * Smart sync: resumes a full sync if one is incomplete, otherwise runs an
   * incremental sync. Deduplicated — callers share the in-flight result.
   */
  sync(repositoryUrl: string, authContext: PrSyncAuthContext = {}): Promise<RepositorySyncResult> {
    const key = `sync:${repositoryUrl}:${authContextKey(authContext)}`;
    const existing = this._inflight.get(key);
    if (existing) {
      log.info('PrSyncEngine: sync already in flight, skipping', {
        repositoryUrl,
      });
      return existing;
    }

    const ctrl = new AbortController();
    this._controllers.set(key, ctrl);

    const promise = this._getFullSyncCursor(repositoryUrl)
      .then((cursor) => {
        if (ctrl.signal.aborted) return err(syncCancelledError());
        return cursor?.done
          ? this._runIncrementalSync(repositoryUrl, ctrl.signal, authContext)
          : this._runFullSync(repositoryUrl, ctrl.signal, authContext);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === 'AbortError') {
          return err(syncCancelledError());
        }
        const repository = parseRepositoryRef(repositoryUrl);
        const error = toPrApiError(
          e,
          'Unable to sync pull requests',
          repository?.host,
          repository?.nameWithOwner
        );
        if (isPrSyncHostUnreachable(error)) {
          log.warn('PrSyncEngine: sync failed; GitHub host unreachable', {
            repositoryUrl,
            host: error.host,
            error: error.reason,
          });
          return err(error);
        }
        log.error('PrSyncEngine: sync failed', {
          repositoryUrl,
          error: String(e),
        });
        return err(error);
      })
      .finally(() => {
        if (this._controllers.get(key) === ctrl) {
          this._controllers.delete(key);
        }
        if (this._inflight.get(key) === promise) {
          this._inflight.delete(key);
        }
      });

    this._inflight.set(key, promise);
    return promise;
  }

  /** Cancel any in-flight sync, wipe both cursors, and start a fresh full sync. */
  async forceFullSync(
    repositoryUrl: string,
    authContext: PrSyncAuthContext = {}
  ): Promise<RepositorySyncResult> {
    this.cancel(repositoryUrl);
    await Promise.all([
      this.kv.del(`fullsync:${repositoryUrl}`),
      this.kv.del(`incrementalsync:${repositoryUrl}`),
    ]);
    return this.sync(repositoryUrl, authContext);
  }

  /** Abort and discard any in-flight sync for this repository URL. */
  cancel(repositoryUrl: string): void {
    const prefix = `sync:${repositoryUrl}:`;
    for (const [key, ctrl] of this._controllers) {
      if (!key.startsWith(prefix)) continue;
      ctrl.abort();
      this._controllers.delete(key);
      this._inflight.delete(key);
    }
  }

  /** Cancel any in-flight syncs for a project and clean up its PR rows and KV cursors. */
  async deleteProjectData(projectId: string): Promise<void> {
    log.info('PrSyncEngine: deleteProjectData', { projectId });

    const remoteRows = await db
      .select({ remoteUrl: projectRemotes.remoteUrl })
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));

    if (remoteRows.length === 0) return;

    for (const { remoteUrl: url } of remoteRows) {
      this.cancel(url);

      const shared = await db
        .select({ projectId: projectRemotes.projectId })
        .from(projectRemotes)
        .where(and(eq(projectRemotes.remoteUrl, url), ne(projectRemotes.projectId, projectId)))
        .limit(1);

      if (shared.length > 0) {
        log.info(
          'PrSyncEngine: deleteProjectData — remote shared with other project, skipping data cleanup',
          { url }
        );
        continue;
      }

      log.info('PrSyncEngine: deleteProjectData — deleting PR rows and KV cursors', { url });
      await db.delete(pullRequests).where(eq(pullRequests.repositoryUrl, url));
      await Promise.all([
        this.kv.del(`fullsync:${url}`),
        this.kv.del(`incrementalsync:${url}`),
        this.kv.del(`users-synced-at:${url}`),
      ]);
    }
  }

  // ── Full sync (private implementation) ────────────────────────────────────

  /**
   * Paginate through all PRs for a repository ordered by updatedAt DESC.
   * Saves a cursor after each page so it can be resumed on restart.
   * Sets `done: true` once the cutoff is reached or history is exhausted.
   */
  private async _runFullSync(
    repositoryUrl: string,
    signal: AbortSignal,
    authContext: PrSyncAuthContext
  ): Promise<RepositorySyncResult> {
    log.info('PrSyncEngine: runFullSync start', { repositoryUrl });
    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) {
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'full',
        status: 'error',
        error: prSyncEngineErrorMessage(repository.error),
      });
      return err(repository.error);
    }
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) {
      log.warn('PrSyncEngine: runFullSync — failed to get Octokit', {
        repositoryUrl,
        error: octokit.error,
      });
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'full',
        status: 'error',
        error: prSyncEngineErrorMessage(octokit.error),
      });
      return err(octokit.error);
    }

    // Resume from an existing cursor if available
    const existing = (await this.kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
    let pageCursor: string | undefined = existing?.done ? undefined : existing?.pageCursor;

    let synced = 0;

    this._emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'full',
      status: 'running',
      synced: 0,
    });

    try {
      for (;;) {
        if (signal.aborted) {
          this._emitProgress({
            remoteUrl: repositoryUrl,
            kind: 'full',
            status: 'cancelled',
          });
          return err(syncCancelledError());
        }

        const response = await withRetry(
          () =>
            githubRateLimiter.acquire().then(() =>
              octokit.data.graphql<{
                repository: {
                  pullRequests: {
                    totalCount: number;
                    pageInfo: {
                      hasNextPage: boolean;
                      endCursor: string | null;
                    };
                    nodes: GqlPrNode[];
                  };
                };
              }>(SYNC_PRS_QUERY, {
                owner,
                repo,
                cursor: pageCursor ?? null,
                request: { signal },
              })
            ),
          { signal }
        );

        const { nodes, pageInfo, totalCount } = response.repository.pullRequests;
        const batch: GqlPrNode[] = nodes.slice();

        if (batch.length > 0) {
          const upserted = await this._upsertBatch(repositoryUrl, batch);
          this._notifyPrsUpdated(upserted);
          synced += batch.length;
        }

        const lastUpdatedAt =
          batch[batch.length - 1]?.updatedAt ?? existing?.lastUpdatedAt ?? new Date().toISOString();
        const done = !pageInfo.hasNextPage || synced >= PR_SYNC_MAX_COUNT;

        await this.kv.set(`fullsync:${repositoryUrl}`, {
          lastUpdatedAt,
          done,
          pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
        } as FullSyncCursor);

        this._emitProgress({
          remoteUrl: repositoryUrl,
          kind: 'full',
          status: 'running',
          synced,
          total: Math.min(totalCount, PR_SYNC_MAX_COUNT),
        });

        if (done) break;
        pageCursor = pageInfo.endCursor ?? undefined;
      }

      await this._archiveOldPrs(repositoryUrl);
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'full',
        status: 'done',
        synced,
      });
      return ok();
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') {
        this._emitProgress({
          remoteUrl: repositoryUrl,
          kind: 'full',
          status: 'cancelled',
        });
        return err(syncCancelledError());
      }
      const error = toPrApiError(
        e,
        'Unable to sync pull requests',
        repository.data.host,
        repository.data.nameWithOwner
      );
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'full',
        status: 'error',
        error: prSyncEngineErrorMessage(error),
      });
      return err(error);
    }
  }

  // ── Incremental sync (private implementation) ─────────────────────────────

  /**
   * Fetch only open PRs updated since the last incremental-sync cursor.
   * Resumable: saves a page cursor so it can continue where it left off.
   * Callers must ensure full sync is complete before calling this (sync() does this).
   */
  private async _runIncrementalSync(
    repositoryUrl: string,
    signal: AbortSignal,
    authContext: PrSyncAuthContext
  ): Promise<RepositorySyncResult> {
    log.info('PrSyncEngine: runIncrementalSync started', { repositoryUrl });

    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) {
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'incremental',
        status: 'error',
        error: prSyncEngineErrorMessage(repository.error),
      });
      return err(repository.error);
    }
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) {
      log.warn('PrSyncEngine: runIncrementalSync — failed to get Octokit', {
        repositoryUrl,
        error: octokit.error,
      });
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'incremental',
        status: 'error',
        error: prSyncEngineErrorMessage(octokit.error),
      });
      return err(octokit.error);
    }

    const fullCursor = (await this.kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
    const incrementalCursor = (await this.kv.get(
      `incrementalsync:${repositoryUrl}`
    )) as IncrementalSyncCursor | null;
    const sinceUpdatedAt =
      incrementalCursor?.lastUpdatedAt ?? fullCursor?.lastUpdatedAt ?? new Date(0).toISOString();

    let pageCursor: string | undefined = incrementalCursor?.done
      ? undefined
      : incrementalCursor?.pageCursor;
    let synced = 0;
    let lastUpdatedAt = sinceUpdatedAt;

    this._emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'incremental',
      status: 'running',
      synced: 0,
    });

    try {
      for (;;) {
        if (signal.aborted) {
          this._emitProgress({
            remoteUrl: repositoryUrl,
            kind: 'incremental',
            status: 'cancelled',
          });
          return err(syncCancelledError());
        }

        const response = await withRetry(
          () =>
            githubRateLimiter.acquire().then(() =>
              octokit.data.graphql<{
                repository: {
                  pullRequests: {
                    pageInfo: {
                      hasNextPage: boolean;
                      endCursor: string | null;
                    };
                    nodes: GqlPrNode[];
                  };
                };
              }>(INCREMENTAL_SYNC_PRS_QUERY, {
                owner,
                repo,
                cursor: pageCursor ?? null,
                request: { signal },
              })
            ),
          { signal }
        );

        const { nodes, pageInfo } = response.repository.pullRequests;
        let reachedBoundary = false;
        const batch: GqlPrNode[] = [];

        for (const node of nodes) {
          if (node.updatedAt < sinceUpdatedAt) {
            reachedBoundary = true;
            break;
          }
          batch.push(node);
        }

        if (batch.length > 0) {
          const upserted = await this._upsertBatch(repositoryUrl, batch);
          this._notifyPrsUpdated(upserted);
          synced += batch.length;
          lastUpdatedAt = batch[0].updatedAt; // most recent first
        }

        // If we've processed too many PRs, the cursor is too stale — reset to a full sync.
        if (synced >= PR_SYNC_MAX_COUNT) {
          log.info('PrSyncEngine: incremental overflow — resetting to full sync', {
            repositoryUrl,
            synced,
          });
          await this.kv.del(`fullsync:${repositoryUrl}`);
          await this.kv.del(`incrementalsync:${repositoryUrl}`);
          this._emitProgress({
            remoteUrl: repositoryUrl,
            kind: 'incremental',
            status: 'done',
            synced,
          });
          return ok();
        }

        const done = reachedBoundary || !pageInfo.hasNextPage;

        await this.kv.set(`incrementalsync:${repositoryUrl}`, {
          lastUpdatedAt,
          pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
          done,
        } as IncrementalSyncCursor);

        this._emitProgress({
          remoteUrl: repositoryUrl,
          kind: 'incremental',
          status: 'running',
          synced,
        });

        if (done) break;
        pageCursor = pageInfo.endCursor ?? undefined;
      }

      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'incremental',
        status: 'done',
        synced,
      });
      return ok();
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') {
        this._emitProgress({
          remoteUrl: repositoryUrl,
          kind: 'incremental',
          status: 'cancelled',
        });
        return err(syncCancelledError());
      }
      const error = toPrApiError(
        e,
        'Unable to sync pull requests',
        repository.data.host,
        repository.data.nameWithOwner
      );
      this._emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'incremental',
        status: 'error',
        error: prSyncEngineErrorMessage(error),
      });
      return err(error);
    }
  }

  // ── Single PR sync ─────────────────────────────────────────────────────────

  /** Sync a single PR by number. Deduplicated — awaits any in-flight call for the same PR. */
  async syncSingle(
    repositoryUrl: string,
    prNumber: number,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<PullRequest | null, PrSyncEngineError>> {
    const key = `single:${repositoryUrl}:${prNumber}:${authContextKey(authContext)}`;
    if (this._singleInflight.has(key)) {
      return await this._singleInflight.get(key)!;
    }

    const ctrl = new AbortController();

    const promise = this._runSyncSingle(repositoryUrl, prNumber, ctrl.signal, authContext)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: syncSingle failed', {
            repositoryUrl,
            prNumber,
            error: String(e),
          });
          return err(toPrApiError(e, 'Unable to refresh pull request'));
        }
        return ok(null);
      })
      .finally(() => {
        this._singleInflight.delete(key);
      });

    this._singleInflight.set(key, promise);
    return await promise;
  }

  private async _runSyncSingle(
    repositoryUrl: string,
    prNumber: number,
    signal: AbortSignal,
    authContext: PrSyncAuthContext
  ): Promise<Result<PullRequest | null, PrSyncEngineError>> {
    if (signal.aborted) return ok(null);

    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);

    let response: { repository: { pullRequest: GqlPrNode | null } };
    try {
      response = await withRetry(() =>
        githubRateLimiter.acquire().then(() =>
          octokit.data.graphql<{
            repository: { pullRequest: GqlPrNode | null };
          }>(GET_PR_BY_NUMBER_QUERY, { owner, repo, number: prNumber })
        )
      );
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to refresh pull request',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }

    const node = response.repository.pullRequest;
    if (!node) return ok(null);

    const [pr] = await this._upsertBatch(repositoryUrl, [node]);
    if (pr) {
      this._notifyPrUpdated(pr);
    }

    this._emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'single',
      status: 'done',
      synced: 1,
    });
    return ok(pr ?? null);
  }

  // ── Check runs sync ────────────────────────────────────────────────────────

  /**
   * Fetch and store check runs for a PR. Deduplicated — awaits any in-flight call.
   * Returns true if any check is still running (caller should re-invoke soon).
   */
  async syncChecks(
    pullRequestUrl: string,
    headRefOid: string,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<boolean, PrSyncEngineError>> {
    const key = `checks:${pullRequestUrl}:${headRefOid}:${authContextKey(authContext)}`;
    if (this._checksInflight.has(key)) {
      return await this._checksInflight.get(key)!;
    }

    const ctrl = new AbortController();

    const promise = this._runSyncChecks(pullRequestUrl, headRefOid, ctrl.signal, authContext)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: syncChecks failed', {
            pullRequestUrl,
            error: String(e),
          });
          return err(toPrApiError(e, 'Unable to sync check runs'));
        }
        return ok(false);
      })
      .finally(() => {
        this._checksInflight.delete(key);
      });

    this._checksInflight.set(key, promise);
    return await promise;
  }

  private async _runSyncChecks(
    pullRequestUrl: string,
    headRefOid: string,
    signal: AbortSignal,
    authContext: PrSyncAuthContext
  ): Promise<Result<boolean, PrSyncEngineError>> {
    if (signal.aborted) return ok(false);

    // Detect stale checks: delete if commitSha changed
    const existing = await db
      .select({ commitSha: pullRequestChecks.commitSha })
      .from(pullRequestChecks)
      .where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl))
      .limit(1);

    if (existing.length > 0 && existing[0].commitSha !== headRefOid) {
      await db
        .delete(pullRequestChecks)
        .where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl));
    }

    // Fetch fresh check runs from GitHub
    const pr = await db
      .select({
        identifier: pullRequests.identifier,
        repositoryUrl: pullRequests.repositoryUrl,
      })
      .from(pullRequests)
      .where(eq(pullRequests.url, pullRequestUrl))
      .limit(1);

    if (!pr[0]) return ok(false);

    const prNumber = pr[0].identifier ? parseInt(pr[0].identifier.replace('#', ''), 10) : NaN;
    if (isNaN(prNumber)) return ok(false);

    const repository = parseRepositoryRefResult(pr[0].repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);

    type CheckNode = GqlCheckRunNode | GqlStatusContextNode;
    const allNodes: CheckNode[] = [];
    let cursor: string | undefined;

    for (;;) {
      if (signal.aborted) return ok(false);

      let response: {
        repository: {
          pullRequest: {
            commits: {
              nodes: Array<{
                commit: {
                  oid: string;
                  statusCheckRollup: {
                    contexts: {
                      pageInfo: {
                        hasNextPage: boolean;
                        endCursor: string | null;
                      };
                      nodes: CheckNode[];
                    };
                  } | null;
                };
              }>;
            };
          } | null;
        };
      };
      try {
        response = await withRetry(() =>
          githubRateLimiter.acquire().then(() =>
            octokit.data.graphql(GET_PR_CHECK_RUNS_BY_URL_QUERY, {
              owner,
              repo,
              number: prNumber,
              cursor: cursor ?? null,
            })
          )
        );
      } catch (error) {
        return err(
          toPrApiError(
            error,
            'Unable to sync check runs',
            repository.data.host,
            repository.data.nameWithOwner
          )
        );
      }

      const contexts =
        response.repository.pullRequest?.commits.nodes[0]?.commit?.statusCheckRollup?.contexts;
      if (!contexts) break;

      allNodes.push(...contexts.nodes);
      if (!contexts.pageInfo.hasNextPage) break;
      cursor = contexts.pageInfo.endCursor ?? undefined;
    }

    // Delete and re-insert
    await db.delete(pullRequestChecks).where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl));

    if (allNodes.length > 0) {
      await db.insert(pullRequestChecks).values(
        allNodes.map((node) => {
          if (node.__typename === 'CheckRun') {
            return {
              id: randomUUID(),
              pullRequestUrl,
              commitSha: headRefOid,
              name: node.name,
              status: node.status,
              conclusion: node.conclusion ?? 'NEUTRAL',
              detailsUrl: node.detailsUrl ?? null,
              startedAt: node.startedAt ?? null,
              completedAt: node.completedAt ?? null,
              workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
              appName: node.checkSuite?.app?.name ?? null,
              appLogoUrl: node.checkSuite?.app?.logoUrl ?? null,
            };
          }
          // StatusContext
          return {
            id: randomUUID(),
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
            detailsUrl: node.targetUrl ?? null,
            startedAt: node.createdAt,
            completedAt: node.state !== 'PENDING' ? node.createdAt : null,
            workflowName: null,
            appName: null,
            appLogoUrl: null,
          };
        })
      );
    }

    // Return true if any check is still in-progress
    const hasRunning = allNodes.some((n) => {
      if (n.__typename === 'CheckRun') {
        return (
          n.status === 'IN_PROGRESS' ||
          n.status === 'QUEUED' ||
          n.status === 'WAITING' ||
          n.status === 'PENDING'
        );
      }
      return n.state === 'PENDING';
    });

    // Notify the renderer with the fully-assembled PR so checks appear reactively.
    await this._notifyPrWithChecks(pullRequestUrl);

    return ok(hasRunning);
  }

  private async _notifyPrWithChecks(pullRequestUrl: string): Promise<void> {
    const [prRow] = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.url, pullRequestUrl))
      .limit(1);

    if (!prRow) return;

    const [checkRows, labelRows, assigneeJoins] = await Promise.all([
      db
        .select()
        .from(pullRequestChecks)
        .where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl)),
      db
        .select()
        .from(pullRequestLabels)
        .where(eq(pullRequestLabels.pullRequestId, pullRequestUrl)),
      db
        .select({ user: pullRequestUsers })
        .from(pullRequestAssignees)
        .innerJoin(pullRequestUsers, eq(pullRequestAssignees.userId, pullRequestUsers.userId))
        .where(eq(pullRequestAssignees.pullRequestUrl, pullRequestUrl)),
    ]);

    let authorRow: typeof pullRequestUsers.$inferSelect | null = null;
    if (prRow.authorUserId) {
      const [a] = await db
        .select()
        .from(pullRequestUsers)
        .where(eq(pullRequestUsers.userId, prRow.authorUserId))
        .limit(1);
      authorRow = a ?? null;
    }

    const assembled = assemblePullRequest(
      prRow,
      authorRow,
      labelRows,
      assigneeJoins.map((j) => j.user),
      checkRows
    );
    this._notifyPrUpdated(assembled);
  }

  // ── Users sync ─────────────────────────────────────────────────────────────

  /** Sync users referenced by PRs in this repository. Runs at most once per day. */
  async syncUsers(repositoryUrl: string): Promise<void> {
    const tsKey = `users-synced-at:${repositoryUrl}`;
    const lastSync = (await this.kv.get(tsKey)) as string | null;
    if (lastSync) {
      const age = Date.now() - new Date(lastSync).getTime();
      if (age < 24 * 60 * 60 * 1000) return;
    }
    await this.kv.set(tsKey, new Date().toISOString());
    // Users are upserted inline during _upsertBatch, so this is a no-op for now.
    // Reserved for future use (e.g. refreshing user profile pics in bulk).
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _upsertBatch(repositoryUrl: string, nodes: GqlPrNode[]): Promise<PullRequest[]> {
    const results: PullRequest[] = [];

    for (const node of nodes) {
      const pr = await this._upsertOne(repositoryUrl, node);
      if (pr) results.push(pr);
    }

    return results;
  }

  private async _upsertOne(repositoryUrl: string, node: GqlPrNode): Promise<PullRequest | null> {
    const status: PullRequestStatus =
      node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open';

    const headRepositoryUrl =
      parseRepositoryRef(node.headRepository?.url)?.repositoryUrl ?? repositoryUrl;

    const baseRepositoryUrl =
      parseRepositoryRef(node.baseRepository?.url)?.repositoryUrl ?? repositoryUrl;

    // Upsert author
    let authorUserId: string | null = null;
    if (node.author) {
      authorUserId = actorUserId(node.author);
      await db
        .insert(pullRequestUsers)
        .values({
          userId: authorUserId,
          userName: node.author.login,
          displayName: node.author.login,
          avatarUrl: node.author.avatarUrl || null,
          url: node.author.url ?? null,
          userCreatedAt: node.author.createdAt ?? null,
          userUpdatedAt: node.author.updatedAt ?? null,
        })
        .onConflictDoUpdate({
          target: pullRequestUsers.userId,
          set: {
            userName: node.author.login,
            displayName: node.author.login,
            avatarUrl: node.author.avatarUrl || null,
          },
        });
    }

    // Upsert PR row
    const [prRow] = await db
      .insert(pullRequests)
      .values({
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
        description: node.body ?? null,
        status,
        isDraft: node.isDraft ? 1 : 0,
        authorUserId,
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        commitCount: node.commitCount?.totalCount ?? null,
        mergeableStatus: node.mergeable,
        mergeStateStatus: node.mergeStateStatus ?? null,
        reviewDecision: node.reviewDecision ?? null,
        pullRequestCreatedAt: node.createdAt,
        pullRequestUpdatedAt: node.updatedAt,
      })
      .onConflictDoUpdate({
        target: pullRequests.url,
        set: {
          baseRefName: node.baseRefName,
          baseRefOid: node.baseRefOid,
          headRepositoryUrl,
          headRefName: node.headRefName,
          headRefOid: node.headRefOid,
          title: node.title,
          description: node.body ?? null,
          status,
          isDraft: node.isDraft ? 1 : 0,
          authorUserId,
          additions: node.additions,
          deletions: node.deletions,
          changedFiles: node.changedFiles,
          commitCount: node.commitCount?.totalCount ?? null,
          mergeableStatus: node.mergeable,
          mergeStateStatus: node.mergeStateStatus ?? null,
          reviewDecision: node.reviewDecision ?? null,
          pullRequestUpdatedAt: node.updatedAt,
        },
      })
      .returning();

    if (!prRow) return null;

    // Sync labels
    await db.delete(pullRequestLabels).where(eq(pullRequestLabels.pullRequestId, node.url));
    if (node.labels.nodes.length > 0) {
      await db.insert(pullRequestLabels).values(
        node.labels.nodes.map((l) => ({
          pullRequestId: node.url,
          name: l.name,
          color: l.color ?? null,
        }))
      );
    }

    // Upsert assignee users and links
    await db.delete(pullRequestAssignees).where(eq(pullRequestAssignees.pullRequestUrl, node.url));
    const assigneeRows: (typeof pullRequestUsers.$inferSelect)[] = [];
    for (const a of node.assignees.nodes) {
      const uid = actorUserId(a);
      await db
        .insert(pullRequestUsers)
        .values({
          userId: uid,
          userName: a.login,
          displayName: a.login,
          avatarUrl: a.avatarUrl || null,
          url: a.url ?? null,
          userCreatedAt: a.createdAt ?? null,
          userUpdatedAt: a.updatedAt ?? null,
        })
        .onConflictDoUpdate({
          target: pullRequestUsers.userId,
          set: {
            userName: a.login,
            displayName: a.login,
            avatarUrl: a.avatarUrl || null,
          },
        });

      await db
        .insert(pullRequestAssignees)
        .values({ pullRequestUrl: node.url, userId: uid })
        .onConflictDoNothing();

      assigneeRows.push({
        userId: uid,
        userName: a.login,
        displayName: a.login,
        avatarUrl: a.avatarUrl || null,
        url: a.url ?? null,
        userCreatedAt: a.createdAt ?? null,
        userUpdatedAt: a.updatedAt ?? null,
      });
    }

    const authorRow = node.author
      ? {
          userId: actorUserId(node.author),
          userName: node.author.login,
          displayName: node.author.login,
          avatarUrl: node.author.avatarUrl || null,
          url: node.author.url ?? null,
          userCreatedAt: node.author.createdAt ?? null,
          userUpdatedAt: node.author.updatedAt ?? null,
        }
      : null;

    const labelRows = node.labels.nodes.map((l) => ({
      pullRequestId: node.url,
      name: l.name,
      color: l.color ?? null,
    }));

    const checkRows = await db
      .select()
      .from(pullRequestChecks)
      .where(eq(pullRequestChecks.pullRequestUrl, node.url));

    return assemblePullRequest(prRow, authorRow, labelRows, assigneeRows, checkRows);
  }

  private async _archiveOldPrs(repositoryUrl: string): Promise<void> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PR_ARCHIVE_AGE_MONTHS);
    const cutoffIso = cutoff.toISOString();

    await db
      .delete(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryUrl, repositoryUrl),
          inArray(pullRequests.status, ['closed', 'merged']),
          lt(pullRequests.pullRequestUpdatedAt, cutoffIso)
        )
      );

    log.info('PrSyncEngine: archived old PRs', { repositoryUrl, cutoffIso });
  }

  private _notifyPrUpdated(pr: PullRequest): void {
    events.emit(prUpdatedChannel, { prs: [pr] });
  }

  private _notifyPrsUpdated(prs: PullRequest[]): void {
    if (prs.length === 0) return;
    events.emit(prUpdatedChannel, { prs });
  }

  private _emitProgress(progress: PrSyncProgress): void {
    events.emit(prSyncProgressChannel, progress);
  }

  // ── Mutation helpers (for controller use) ──────────────────────────────────

  async createPullRequest(
    params: {
      repositoryUrl: string;
      headRepositoryUrl?: string;
      head: string;
      base: string;
      title: string;
      body?: string;
      draft: boolean;
    },
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<{ url: string; number: number }, PrSyncEngineError>> {
    const repository = parseRepositoryRefResult(params.repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);
    try {
      const response = await octokit.data.rest.pulls.create({
        owner,
        repo,
        head: params.head,
        base: params.base,
        title: params.title,
        body: params.body,
        draft: params.draft,
      });
      const { html_url: url, number } = response.data;
      return ok({ url, number });
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to create pull request',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }
  }

  async mergePullRequest(
    repositoryUrl: string,
    prNumber: number,
    options: PullRequestMergeOptions,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<{ sha: string | null; merged: boolean }, PrSyncEngineError>> {
    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);
    try {
      // GitHub exposes bypassing branch protection/rulesets through the caller's permissions,
      // not a REST merge parameter. `bypassRequirements` is captured by the UI/telemetry path;
      // the merge request itself remains identical and GitHub accepts or rejects it server-side.
      const response = await octokit.data.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: options.strategy,
        sha: options.commitHeadOid,
      });
      return ok({
        sha: response.data.sha ?? null,
        merged: response.data.merged,
      });
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to merge pull request',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }
  }

  async markReadyForReview(
    repositoryUrl: string,
    prNumber: number,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<void, PrSyncEngineError>> {
    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);
    try {
      const { data } = await octokit.data.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      await octokit.data.graphql(
        `mutation MarkReadyForReview($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
        { id: data.node_id }
      );
      return ok();
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to mark PR ready for review',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }
  }

  async getPullRequestComments(
    repositoryUrl: string,
    prNumber: number,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<PullRequestComment[], PrSyncEngineError>> {
    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);
    const pullRequestUrl = `${repository.data.repositoryUrl}/pull/${prNumber}`;

    try {
      const [issueComments, reviewComments, reviews] = await Promise.all([
        withRetry(() =>
          githubRateLimiter.acquire().then(() =>
            octokit.data.paginate(octokit.data.rest.issues.listComments, {
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            })
          )
        ),
        withRetry(() =>
          githubRateLimiter.acquire().then(() =>
            octokit.data.paginate(octokit.data.rest.pulls.listReviewComments, {
              owner,
              repo,
              pull_number: prNumber,
              per_page: 100,
            })
          )
        ),
        withRetry(() =>
          githubRateLimiter.acquire().then(() =>
            octokit.data.paginate(octokit.data.rest.pulls.listReviews, {
              owner,
              repo,
              pull_number: prNumber,
              per_page: 100,
            })
          )
        ),
      ]);

      return ok([
        ...issueComments.map((comment) => ({
          id: `issue-comment:${comment.id}`,
          pullRequestUrl,
          kind: 'issue' as const,
          body: comment.body ?? '',
          url: comment.html_url,
          author: comment.user ? restUserToPullRequestUser(comment.user) : null,
          path: null,
          line: null,
          isResolved: false,
          isOutdated: false,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        })),
        ...reviews.flatMap((review) => {
          if (!review.body?.trim() || !review.submitted_at) return [];
          return {
            id: `review:${review.id}`,
            pullRequestUrl,
            kind: 'review' as const,
            body: review.body,
            url: review.html_url,
            author: review.user ? restUserToPullRequestUser(review.user) : null,
            path: null,
            line: null,
            isResolved: false,
            isOutdated: false,
            createdAt: review.submitted_at,
            updatedAt: review.submitted_at,
          };
        }),
        ...reviewComments.map((comment) => ({
          id: `review-comment:${comment.id}`,
          pullRequestUrl,
          kind: 'review' as const,
          body: comment.body ?? '',
          url: comment.html_url,
          author: comment.user ? restUserToPullRequestUser(comment.user) : null,
          path: comment.path ?? null,
          line: comment.line ?? comment.original_line ?? null,
          isResolved: false,
          isOutdated: comment.position == null,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        })),
      ]);
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to get pull request comments',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    prNumber: number,
    authContext: PrSyncAuthContext = {}
  ): Promise<Result<PullRequestFile[], PrSyncEngineError>> {
    const repository = parseRepositoryRefResult(repositoryUrl);
    if (!repository.success) return err(repository.error);
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit(repository.data.host, authContext);
    if (!octokit.success) return err(octokit.error);
    try {
      const files = await octokit.data.paginate(octokit.data.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      return ok(
        files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        }))
      );
    } catch (error) {
      return err(
        toPrApiError(
          error,
          'Unable to get pull request files',
          repository.data.host,
          repository.data.nameWithOwner
        )
      );
    }
  }

  private async _getFullSyncCursor(repositoryUrl: string): Promise<{ done: boolean } | null> {
    return (await this.kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
  }
}

export const prSyncEngine = new PrSyncEngine(getOctokit);

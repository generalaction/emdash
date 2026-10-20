import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { IntegrationCredentials } from '../integrations/host';
import type {
  PullRequest,
  PullRequestAuthError,
  PullRequestCheck,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
} from './schemas';

/** Provider data observed by a request batch, timestamped before its first request. */
export type Observed<T> = { data: T; fetchedAt: number };
export type PullRequestMetadata = Omit<
  PullRequest,
  'checks' | 'checksFetchedAt' | 'metadataFetchedAt'
>;
export type PullRequestPage = {
  prs: PullRequestMetadata[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount?: number;
  /** Fields absent from inventory; unchanged records retain their cached detail values. */
  detailOnlyFields?: (keyof PullRequestMetadata)[];
};

export type PullRequestOperationErrorType =
  | 'sync_failed'
  | 'refresh_failed'
  | 'checks_failed'
  | 'comments_failed'
  | 'create_failed'
  | 'merge_failed'
  | 'mark_ready_failed'
  | 'files_failed';

/**
 * The account and credential record the host resolved for one repository.
 * `credentials` is the integration's stored record; plugins narrow it with
 * their integration's `credentialsSchema`.
 */
export type PullRequestCredentials = {
  accountId?: string;
  credentials: IntegrationCredentials;
};

/**
 * Host services for a pull-request client. Credentials are resolved per
 * repository on every request because one client serves every repository of
 * its integration, possibly across several accounts; account changes apply on
 * the next call.
 */
export type PullRequestHostContext = {
  log: Logger;
  scope: Scope;
  resolveCredentials(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<PullRequestCredentials, PullRequestAuthError>>;
};

/** One authenticated repository context for a single git hosting platform. */
export interface PullRequestRepositoryClient {
  readonly identity: string;
  readonly repositoryUrl: string;
  fetchOpenPage(
    cursor: string | null,
    signal: AbortSignal,
    priority?: number
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>>;
  fetchHistoryPage(
    cursor: string | null,
    signal: AbortSignal,
    priority?: number,
    updatedAfter?: string
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>>;
  fetchPullRequest(
    number: number,
    signal: AbortSignal,
    priority?: number
  ): Promise<Result<Observed<PullRequestMetadata>, PullRequestError>>;
  fetchChecks(
    number: number,
    signal: AbortSignal
  ): Promise<
    Result<Observed<{ headRefOid: string; checks: PullRequestCheck[] }>, PullRequestError>
  >;
  fetchComments(
    number: number,
    signal: AbortSignal
  ): Promise<Result<Observed<PullRequestComment[]>, PullRequestError>>;
}

/** A single git hosting platform's PR/MR I/O: fetches and mutates, never cache persistence or refresh policy. */
export interface PullRequestClient {
  openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<PullRequestRepositoryClient, PullRequestError>>;
  createPullRequest(
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
  ): Promise<Result<{ url: string; number: number }, PullRequestError>>;
  mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>>;
  markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>>;
  getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>>;
}

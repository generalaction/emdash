import type { Result } from '@emdash/shared';
import type {
  PullRequest,
  PullRequestCheck,
  PullRequestComment,
  PullRequestError,
} from '../../api';

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
};

/** One authenticated repository context. It has no cache or application lifecycle. */
export interface GitHubPullRequestRepository {
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
    priority?: number
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

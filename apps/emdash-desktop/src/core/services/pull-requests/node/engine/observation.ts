import type { PullRequest } from '../../api';

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

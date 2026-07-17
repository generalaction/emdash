import { createListView } from '@emdash/ui/react/patterns';
import type { ContractClient } from '@emdash/wire/api';
import { pullRequestErrorMessage } from '../api';
import type {
  PullRequest,
  PullRequestFilters,
  PullRequestsContract,
  PullRequestSort,
} from '../api';

export type PullRequestListFilterModel = PullRequestFilters & Record<string, unknown>;

export function createPullRequestListView(options: {
  client: ContractClient<PullRequestsContract>;
  getRepositoryUrls: () => string[];
  pageSize?: number;
}) {
  let getQueryState = (): {
    searchQuery: string;
    filters: PullRequestFilters;
    sort: PullRequestSort;
  } => ({ searchQuery: '', filters: {}, sort: 'newest' });

  const view = createListView({
    getItemId: (pullRequest: PullRequest) => pullRequest.url,
    source: { kind: 'sync' as const, items: [] as PullRequest[] },
    search: {
      kind: 'sync' as const,
      predicate: () => true,
      debounceMs: 200,
    },
    filter: {
      kind: 'sync' as const,
      initial: {} as PullRequestListFilterModel,
      apply: () => true,
    },
    sort: {
      keys: {
        newest: { label: 'Newest' },
        oldest: { label: 'Oldest' },
        'recently-updated': { label: 'Recently updated' },
      },
      initial: { key: 'newest' as const, dir: 'desc' as const },
    },
    pagination: {
      kind: 'infinite' as const,
      async loadMore(cursor: string | null, signal: AbortSignal) {
        const query = getQueryState();
        const repositoryUrls = options.getRepositoryUrls();
        if (repositoryUrls.length === 0) return { items: [], nextCursor: null };
        const result = await options.client.listPullRequests(
          {
            repositoryUrls,
            cursor,
            limit: options.pageSize ?? 50,
            searchQuery: query.searchQuery || undefined,
            filters: query.filters,
            sort: query.sort,
          },
          { signal }
        );
        if (!result.success) throw new Error(pullRequestErrorMessage(result.error));
        return { items: result.data.prs, nextCursor: result.data.nextCursor };
      },
    },
    selection: { kind: 'single' as const },
  });

  getQueryState = () => ({
    searchQuery: view.store.search?.activeQuery ?? '',
    filters: (view.store.filter?.model ?? {}) as PullRequestFilters,
    sort: (view.store.sort?.key ?? 'newest') as PullRequestSort,
  });

  return view;
}

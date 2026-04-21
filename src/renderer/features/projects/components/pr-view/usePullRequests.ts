import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  ListPrOptions,
  PrFilterOptions,
  PrFilters,
  PrSortField,
  PullRequest,
} from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 50;

export interface UsePullRequestsOptions {
  filters?: PrFilters;
  sort?: PrSortField;
  searchQuery?: string;
  enabled?: boolean;
}

export function usePullRequests(
  projectId?: string,
  repositoryUrl?: string,
  options: UsePullRequestsOptions = {}
) {
  const { filters, sort, searchQuery, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ['pull-requests', projectId, repositoryUrl, filters, sort, searchQuery],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const listOptions: ListPrOptions = {
        limit: PAGE_SIZE,
        offset: pageParam,
        filters,
        sort,
        searchQuery,
      };
      const response = await rpc.pullRequests.listPullRequests(projectId!, listOptions);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load pull requests');
      }
      const prs = (response.prs ?? []) as PullRequest[];
      const syncing = !!(response as { syncing?: boolean }).syncing;
      return {
        prs,
        syncing,
        nextOffset: prs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!projectId && !!repositoryUrl && enabled,
    staleTime: 10 * 60_000,
    refetchInterval: (query) => (query.state.data?.pages[0]?.syncing ? 2_000 : false),
  });

  const prs = query.data?.pages.flatMap((p) => p.prs) ?? [];
  const syncing = query.data?.pages[0]?.syncing ?? false;

  const refresh = useCallback(async () => {
    if (!projectId || !repositoryUrl) return;
    await rpc.pullRequests.syncPullRequests(projectId);
    await queryClient.resetQueries({ queryKey: ['pull-requests', projectId, repositoryUrl] });
    await queryClient.invalidateQueries({ queryKey: ['pr-filter-options', repositoryUrl] });
  }, [queryClient, projectId, repositoryUrl]);

  return {
    prs,
    loading: query.isLoading,
    syncing,
    dataUpdatedAt: query.dataUpdatedAt,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
    refresh,
  };
}

export function useFilterOptions(projectId?: string, repositoryUrl?: string) {
  return useQuery<PrFilterOptions>({
    queryKey: ['pr-filter-options', repositoryUrl],
    queryFn: async () => {
      const response = await rpc.pullRequests.getFilterOptions(projectId!);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load filter options');
      }
      const { authors, labels, assignees } = response as {
        authors: PrFilterOptions['authors'];
        labels: PrFilterOptions['labels'];
        assignees: PrFilterOptions['assignees'];
      };
      return { authors, labels, assignees };
    },
    enabled: !!repositoryUrl,
    staleTime: 60_000,
  });
}

export type { PrFilters, PrSortField } from '@shared/pull-requests';

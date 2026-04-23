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

export const prQueryKeys = {
  list: (projectId: string, repositoryUrl: string) =>
    ['pull-requests', projectId, repositoryUrl] as const,
  listFull: (
    projectId: string,
    repositoryUrl: string,
    filters?: PrFilters,
    sort?: PrSortField,
    searchQuery?: string
  ) => ['pull-requests', projectId, repositoryUrl, filters, sort, searchQuery] as const,
  filterOptions: (repositoryUrl: string) => ['pr-filter-options', repositoryUrl] as const,
};

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
    queryKey: prQueryKeys.listFull(projectId!, repositoryUrl!, filters, sort, searchQuery),
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
      return {
        prs,
        nextOffset: prs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!projectId && !!repositoryUrl && enabled,
    staleTime: 0,
  });

  const prs = query.data?.pages.flatMap((p) => p.prs) ?? [];

  const refresh = useCallback(async () => {
    if (!projectId || !repositoryUrl) return;
    await rpc.pullRequests.syncPullRequests(projectId);
    await queryClient.invalidateQueries({ queryKey: prQueryKeys.list(projectId, repositoryUrl) });
    await queryClient.invalidateQueries({
      queryKey: prQueryKeys.filterOptions(repositoryUrl),
    });
  }, [queryClient, projectId, repositoryUrl]);

  return {
    prs,
    loading: query.isLoading,
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
    queryKey: prQueryKeys.filterOptions(repositoryUrl!),
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

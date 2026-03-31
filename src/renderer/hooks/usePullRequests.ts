import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  ListPrOptions,
  PrFilterOptions,
  PrFilters,
  PrSortField,
  PullRequest,
} from '@shared/pull-requests';
import { rpc } from '../core/ipc';

const PAGE_SIZE = 50;

export interface UsePullRequestsOptions {
  filters?: PrFilters;
  sort?: PrSortField;
  searchQuery?: string;
  enabled?: boolean;
}

export function usePullRequests(
  projectId?: string,
  nameWithOwner?: string,
  options: UsePullRequestsOptions = {}
) {
  const { filters, sort, searchQuery, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ['pull-requests', projectId, nameWithOwner, filters, sort, searchQuery],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const listOptions: ListPrOptions = {
        limit: PAGE_SIZE,
        offset: pageParam,
        filters,
        sort,
        searchQuery,
      };
      const response = await rpc.pullRequests.listPullRequests(
        projectId!,
        nameWithOwner!,
        listOptions
      );
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load pull requests');
      }
      const prs = (response.prs ?? []) as PullRequest[];
      return { prs, nextOffset: prs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!projectId && !!nameWithOwner && enabled,
    staleTime: 30_000,
  });

  const prs = query.data?.pages.flatMap((p) => p.prs) ?? [];

  const refresh = useCallback(async () => {
    if (!projectId || !nameWithOwner) return;
    await rpc.pullRequests.syncPullRequests(projectId, nameWithOwner);
    await queryClient.resetQueries({ queryKey: ['pull-requests', projectId, nameWithOwner] });
    await queryClient.invalidateQueries({ queryKey: ['pr-filter-options', nameWithOwner] });
  }, [queryClient, projectId, nameWithOwner]);

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

export function useFilterOptions(projectId?: string, nameWithOwner?: string) {
  return useQuery<PrFilterOptions>({
    queryKey: ['pr-filter-options', nameWithOwner],
    queryFn: async () => {
      const response = await rpc.pullRequests.getFilterOptions(nameWithOwner!);
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
    enabled: !!nameWithOwner,
    staleTime: 60_000,
  });
}

export type { PrFilters, PrSortField } from '@shared/pull-requests';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { prSyncProgressChannel } from '@shared/events/prEvents';
import type {
  ListPrOptions,
  PrFilterOptions,
  PrFilters,
  PrSortField,
  PullRequest,
} from '@shared/pull-requests';
import { events, rpc } from '@renderer/lib/ipc';

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
      return {
        prs,
        nextOffset: prs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!projectId && !!repositoryUrl && enabled,
    staleTime: 10 * 60_000,
  });

  // Invalidate the PR list whenever the sync engine upserts a new batch so
  // PRs stream in as they arrive rather than waiting for the sync to finish.
  useEffect(() => {
    if (!projectId || !repositoryUrl) return;
    return events.on(prSyncProgressChannel, (progress) => {
      if (progress.remoteUrl !== repositoryUrl || progress.status !== 'running') return;
      void queryClient.invalidateQueries({
        queryKey: ['pull-requests', projectId, repositoryUrl],
      });
    });
  }, [queryClient, projectId, repositoryUrl]);

  const prs = query.data?.pages.flatMap((p) => p.prs) ?? [];

  const refresh = useCallback(async () => {
    if (!projectId || !repositoryUrl) return;
    await rpc.pullRequests.triggerIncrementalSync(projectId);
    await queryClient.invalidateQueries({ queryKey: ['pr-filter-options', repositoryUrl] });
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

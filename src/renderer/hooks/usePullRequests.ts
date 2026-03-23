import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { rpc } from '../core/ipc';

export interface UsePullRequestsOptions {
  limit?: number;
  enabled?: boolean;
}

export function usePullRequests(nameWithOwner?: string, options: UsePullRequestsOptions = {}) {
  const { limit, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pull-requests', nameWithOwner],
    queryFn: async () => {
      const response = await rpc.pullRequests.listPullRequests(nameWithOwner!);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load pull requests');
      }
      const prs = (response.prs ?? []) as PullRequest[];
      return limit ? prs.slice(0, limit) : prs;
    },
    enabled: !!nameWithOwner && enabled,
    staleTime: 30_000,
  });

  // Refresh = sync from GitHub then invalidate query to re-read from DB
  const refresh = useCallback(async () => {
    if (!nameWithOwner) return;
    await rpc.pullRequests.syncPullRequests(nameWithOwner);
    queryClient.invalidateQueries({ queryKey: ['pull-requests', nameWithOwner] });
  }, [queryClient, nameWithOwner]);

  return {
    prs: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
    refresh,
  };
}

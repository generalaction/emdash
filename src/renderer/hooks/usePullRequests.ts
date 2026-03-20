import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { PullRequestSummary } from '@renderer/lib/github';
import { rpc } from '../core/ipc';

export type { PullRequestSummary } from '@renderer/lib/github';

export interface UsePullRequestsOptions {
  searchQuery?: string;
  limit?: number;
  enabled?: boolean;
}

export function usePullRequests(nameWithOwner?: string, options: UsePullRequestsOptions = {}) {
  const { searchQuery, limit, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pull-requests', nameWithOwner, searchQuery],
    queryFn: async () => {
      const response = await rpc.github.listPullRequests(nameWithOwner!, {
        searchQuery,
        limit,
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load pull requests');
      }
      const items = Array.isArray(response.prs) ? response.prs : [];
      return items
        .map(
          (item): PullRequestSummary => ({
            number: Number(item.number) || 0,
            title: String(item.title || `PR #${item.number ?? 'unknown'}`),
            headRefName: String(item.headRefName || ''),
            baseRefName: String(item.baseRefName || ''),
            url: String(item.url || ''),
            isDraft: !!item.isDraft,
            updatedAt: String(item.updatedAt || ''),
            authorLogin: item.author?.login ?? null,
            headRefOid: String(item.headRefOid || ''),
            state: item.state ?? 'OPEN',
            reviewDecision: item.reviewDecision ?? null,
          })
        )
        .filter((item) => item.number > 0);
    },
    enabled: !!nameWithOwner && enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['pull-requests', nameWithOwner] });
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

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import type { PullRequestSummary } from '@renderer/lib/github';
import { rpc } from '../core/ipc';

export type { PullRequestSummary } from '@renderer/lib/github';

export interface UsePullRequestsOptions {
  limit?: number;
  enabled?: boolean;
}

function toSummary(pr: PullRequest): PullRequestSummary {
  const stateMap = { open: 'OPEN', closed: 'CLOSED', merged: 'MERGED' } as const;
  return {
    number: pr.metadata.number,
    title: pr.title,
    headRefName: pr.metadata.headRefName,
    baseRefName: pr.metadata.baseRefName,
    url: pr.url,
    isDraft: pr.isDraft,
    updatedAt: pr.updatedAt,
    authorLogin: pr.author?.userName ?? null,
    headRefOid: pr.metadata.headRefOid,
    state: stateMap[pr.status],
    reviewDecision: pr.metadata.reviewDecision,
  };
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
      const mapped = prs.map(toSummary).filter((item) => item.number > 0);
      return limit ? mapped.slice(0, limit) : mapped;
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

import { useInfiniteQuery } from '@tanstack/react-query';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { checkoutSelector } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';
import { commitRef } from '@shared/core/git/utils';

const PAGE_SIZE = 50;

export type CommitRangeSource = 'pull-request' | 'branch';

export type CommitRange = {
  source: CommitRangeSource;
  baseRefOid: string;
  headRefOid: string;
  revision?: number;
};

export function commitRangeForPullRequest(pr: PullRequest): CommitRange {
  return {
    source: 'pull-request',
    baseRefOid: pr.baseRefOid,
    headRefOid: pr.headRefOid,
  };
}

export const commitsQueryKey = (
  projectId: string,
  workspaceId: string,
  source: CommitRangeSource,
  baseRefOid: string,
  headRefOid: string,
  revision: number
) => [projectId, workspaceId, 'commits', source, baseRefOid, headRefOid, revision] as const;

export function useCommits(projectId: string, workspaceId: string, range: CommitRange | undefined) {
  const source = range?.source ?? 'branch';
  const baseRefOid = range?.baseRefOid ?? '';
  const headRefOid = range?.headRefOid ?? '';
  const revision = range?.revision ?? 0;

  return useInfiniteQuery({
    queryKey: commitsQueryKey(projectId, workspaceId, source, baseRefOid, headRefOid, revision),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (!range) return { commits: [], aheadCount: 0 };

      const workspace = workspaceRegistry.get(projectId, workspaceId);
      if (!workspace) throw new Error('Workspace is unavailable');
      const client = await getGitRuntimeClient();
      const result = await client.checkout.getLog({
        ...checkoutSelector(workspace.path),
        options: {
          limit: PAGE_SIZE,
          skip: pageParam,
          base: commitRef(range.baseRefOid),
          head: commitRef(range.headRefOid),
        },
      });
      if (!result.success) throw new Error('Failed to load commits');
      return { commits: result.data.commits, aheadCount: result.data.totalCount };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.commits.length === PAGE_SIZE ? lastPageParam + PAGE_SIZE : undefined,
    enabled: !!range,
    staleTime: 5 * 60_000,
  });
}

import { useInfiniteQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { commitRef } from '@shared/core/git/utils';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';

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

      const result = await rpc.workspace.gitWorktree.getLog(
        projectId,
        workspaceId,
        PAGE_SIZE,
        pageParam,
        undefined,
        undefined,
        commitRef(range.baseRefOid),
        commitRef(range.headRefOid)
      );
      if (!result.success) throw new Error('Failed to load commits');
      return result.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.commits.length === PAGE_SIZE ? lastPageParam + PAGE_SIZE : undefined,
    enabled: !!range,
    staleTime: 5 * 60_000,
  });
}

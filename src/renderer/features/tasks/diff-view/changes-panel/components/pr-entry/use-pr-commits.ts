import { useInfiniteQuery } from '@tanstack/react-query';
import { commitRef } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 50;

export const prCommitsQueryKey = (workspaceId: string, headRefOid: string) =>
  [workspaceId, 'pr-commits', headRefOid] as const;

export function usePrCommits(projectId: string, workspaceId: string, pr: PullRequest | undefined) {
  return useInfiniteQuery({
    queryKey: prCommitsQueryKey(workspaceId, pr?.headRefOid ?? ''),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const result = await rpc.git.getLog(
        projectId,
        workspaceId,
        PAGE_SIZE,
        pageParam,
        undefined,
        undefined,
        pr ? commitRef(pr.baseRefOid) : undefined,
        pr ? commitRef(pr.headRefOid) : undefined
      );
      if (!result.success) throw new Error('Failed to load commits');
      return result.data.commits;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _all, lastPageParam) =>
      lastPage.length === PAGE_SIZE ? lastPageParam + PAGE_SIZE : undefined,
    enabled: !!pr,
    staleTime: 5 * 60_000,
  });
}

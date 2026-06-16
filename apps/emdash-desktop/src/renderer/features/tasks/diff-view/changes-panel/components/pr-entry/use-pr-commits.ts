import { useInfiniteQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { commitRef } from '@shared/core/git/utils';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';

const PAGE_SIZE = 50;

export const prCommitsQueryKey = (
  projectId: string,
  workspaceId: string,
  baseRefOid: string,
  headRefOid: string
) => [projectId, workspaceId, 'pr-commits', baseRefOid, headRefOid] as const;

export function usePrCommits(projectId: string, workspaceId: string, pr: PullRequest | undefined) {
  return useInfiniteQuery({
    queryKey: prCommitsQueryKey(projectId, workspaceId, pr?.baseRefOid ?? '', pr?.headRefOid ?? ''),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const result = await rpc.workspace.gitWorktree.getLog(
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

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/core/ipc';

type MergeMode = 'merge' | 'squash' | 'rebase';
type MergeResult = { success: true } | { success: false; error: string };

interface PrContextValue {
  pullRequests: PullRequest[];
  nameWithOwner: string | null;
  taskBranch: string | null;
  mergePr: (
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ) => Promise<MergeResult>;
  refreshPullRequest: (id: string) => void;
}

const PrContext = createContext<PrContextValue | null>(null);

export function PrProvider({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['pullRequests', 'task', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.pullRequests.getPullRequestsForTask(projectId, taskId);
      if (!result.success)
        return { prs: [] as PullRequest[], nameWithOwner: null, taskBranch: null };
      return result.data;
    },
    staleTime: 30_000,
  });

  const pullRequests = data?.prs ?? [];
  const nameWithOwner = data?.nameWithOwner ?? null;
  const taskBranch = data?.taskBranch ?? null;

  const mergePr = useCallback(
    async (id: string, options: { strategy: MergeMode; commitHeadOid?: string }) => {
      const pr = pullRequests.find((p) => p.id === id);
      if (!pr) return { success: false, error: 'Pull request not found' } as MergeResult;
      const result = await rpc.pullRequests.mergePullRequest(
        pr.nameWithOwner,
        pr.metadata.number,
        options
      );
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: ['pullRequests', 'task', projectId, taskId],
        });
      }
      return result.success
        ? ({ success: true } as MergeResult)
        : ({ success: false, error: result.error ?? 'Merge failed' } as MergeResult);
    },
    [pullRequests, projectId, taskId, queryClient]
  );

  const refreshPullRequest = useCallback(
    (_id: string) => {
      void queryClient.invalidateQueries({
        queryKey: ['pullRequests', 'task', projectId, taskId],
      });
    },
    [projectId, taskId, queryClient]
  );

  return (
    <PrContext.Provider
      value={{ pullRequests, nameWithOwner, taskBranch, mergePr, refreshPullRequest }}
    >
      {children}
    </PrContext.Provider>
  );
}

export function usePrContext(): PrContextValue {
  const ctx = useContext(PrContext);
  if (!ctx) throw new Error('usePrContext must be used within a PrProvider');
  return ctx;
}

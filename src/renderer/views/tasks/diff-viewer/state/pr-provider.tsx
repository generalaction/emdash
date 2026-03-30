import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { GitChange } from '@shared/git';
import { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/core/ipc';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';

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
  markReadyForReview: (id: string) => Promise<void>;
  refreshPullRequest: (id: string) => void;
  /** Changed files between each PR's base ref and HEAD, keyed by PR id. */
  prFilesMap: Record<string, GitChange[]>;
  activePrFilePath: string | null;
  setActivePrFilePath: (path: string | null) => void;
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
  const [activePrFilePath, setActivePrFilePath] = useState<string | null>(null);

  // Use the GitStore's fileChanges as the reactive trigger for invalidating PR
  // file queries — GitStore already debounces FS watch events so we avoid a
  // second duplicate listener on fsWatchEventChannel.
  const git = asProvisioned(getTaskStore(projectId, taskId))?.git;
  const fileChanges = git?.fileChanges;

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

  const pullRequests = useMemo(() => data?.prs ?? [], [data?.prs]);
  const nameWithOwner = data?.nameWithOwner ?? null;
  const taskBranch = data?.taskBranch ?? null;

  // Fetch changed files for each PR in parallel. Uses the same query keys as the
  // (now removed) PrFilesProvider so StackedDiffView reads from the same cache.
  const prFileQueries = useQueries({
    queries: pullRequests.map((pr) => ({
      queryKey: ['git', 'changedFiles', projectId, taskId, pr.metadata.baseRefName],
      queryFn: async () => {
        const result = await rpc.git.getChangedFiles(projectId, taskId, pr.metadata.baseRefName);
        return result.success ? result.data.changes : ([] as GitChange[]);
      },
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });

  const prFilesMap: Record<string, GitChange[]> = {};
  pullRequests.forEach((pr, i) => {
    prFilesMap[pr.id] = prFileQueries[i]?.data ?? [];
  });

  // Invalidate PR file queries whenever the git store reloads (i.e. after any
  // .git FS change). fileChanges is a MobX observable — React re-runs this
  // effect each time its reference changes after a reload.
  useEffect(() => {
    if (!fileChanges) return;
    for (const pr of pullRequests) {
      void queryClient.invalidateQueries({
        queryKey: ['git', 'changedFiles', projectId, taskId, pr.metadata.baseRefName],
      });
    }
    // pullRequests is intentionally omitted — we only want to re-run on git reload,
    // not every time the PR list itself updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileChanges, projectId, taskId, queryClient]);

  const markReadyForReview = useCallback(
    async (id: string) => {
      const pr = pullRequests.find((p) => p.id === id);
      if (!pr) return;
      await rpc.pullRequests.markReadyForReview(pr.nameWithOwner, pr.metadata.number);
      void queryClient.invalidateQueries({
        queryKey: ['pullRequests', 'task', projectId, taskId],
      });
    },
    [pullRequests, projectId, taskId, queryClient]
  );

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
      void rpc.pullRequests.getPullRequestsForTask(projectId, taskId, true).then(() => {
        void queryClient.invalidateQueries({
          queryKey: ['pullRequests', 'task', projectId, taskId],
        });
      });
    },
    [projectId, taskId, queryClient]
  );

  const handleSetActivePrFilePath = useCallback((path: string | null) => {
    setActivePrFilePath(path);
  }, []);

  return (
    <PrContext.Provider
      value={{
        pullRequests,
        nameWithOwner,
        taskBranch,
        mergePr,
        markReadyForReview,
        refreshPullRequest,
        prFilesMap,
        activePrFilePath,
        setActivePrFilePath: handleSetActivePrFilePath,
      }}
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

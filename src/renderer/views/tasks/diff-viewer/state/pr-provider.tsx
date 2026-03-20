import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { rpc } from '@renderer/core/ipc';
import { useToast } from '@renderer/hooks/use-toast';
import { usePullRequests } from '@renderer/hooks/usePullRequests';
import type { PullRequestDetails, PullRequestSummary } from '@renderer/lib/github';
import { useCurrentProject } from '@renderer/views/projects/project-view-wrapper';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { parseGithubNameWithOwner } from '../utils';
import { useBranchStatus } from './use-branch-status';

export type PrSectionState =
  | 'loading'
  | 'no-remote'
  | 'up-to-date'
  | 'can-create-pr'
  | 'has-pr'
  | 'merged'
  | 'closed';

type MergeMode = 'merge' | 'squash' | 'rebase';
type MergeResult = { success: true } | { success: false; error: string };

interface PrContextValue {
  nameWithOwner: string | null;
  branchName: string | null;
  baseBranch: string | null;
  pr: PullRequestSummary | null;
  prDetails: PullRequestDetails | null;
  state: PrSectionState;
  isLoading: boolean;
  mergePr: (options: { strategy: MergeMode; commitHeadOid?: string }) => Promise<MergeResult>;
  refresh: () => void;
}

const PrContext = createContext<PrContextValue | null>(null);

export function usePrContext(): PrContextValue {
  const ctx = useContext(PrContext);
  if (!ctx) throw new Error('usePrContext must be used within a PrProvider');
  return ctx;
}

export function PrProvider({ children }: { children: ReactNode }) {
  const project = useCurrentProject();
  const { projectId, taskId } = useTaskViewContext();
  const { data: branchData, isLoading: branchLoading } = useBranchStatus({ projectId, taskId });
  const [mergedState, setMergedState] = useState(false);
  const queryClient = useQueryClient();
  const [lastKnownPr, setLastKnownPr] = useState<PullRequestSummary | null>(null);
  const { toast } = useToast();

  // Reset local state when switching tasks
  useEffect(() => {
    setMergedState(false);
    setLastKnownPr(null);
  }, [taskId]);

  // The backend Project shape has `gitRemote` at the top level (from DB schema),
  // but the renderer Project type nests it under `gitInfo.remote`. Check both.
  const projectRemote =
    project?.gitInfo?.remote ??
    ((project as unknown as Record<string, unknown> | null)?.gitRemote as string | undefined);

  const nameWithOwner = useMemo(() => {
    if (projectRemote) {
      const parsed = parseGithubNameWithOwner(projectRemote);
      if (parsed) return parsed;
    }
    return project?.githubInfo?.repository ?? null;
  }, [projectRemote, project?.githubInfo?.repository]);

  const branchName = branchData?.branch ?? null;

  const defaultBranchQuery = useQuery({
    queryKey: ['default-branch', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getDefaultBranch(projectId, taskId);
      if (!result.success) return 'main';
      return result.data.name;
    },
    enabled: !!branchName && !!nameWithOwner,
    staleTime: 60_000,
  });
  const defaultBranch = defaultBranchQuery.data ?? null;

  const { prs, loading: prsLoading } = usePullRequests(nameWithOwner ?? undefined, {
    enabled: !!nameWithOwner && !!branchName,
  });

  const matchingPr = useMemo(() => {
    if (!branchName) return null;
    return prs.find((pr) => pr.headRefName === branchName) ?? null;
  }, [prs, branchName]);

  const prDetailsQuery = useQuery({
    queryKey: ['pr-details', nameWithOwner, matchingPr?.number],
    queryFn: async () => {
      const result = await rpc.github.getPullRequestDetails(nameWithOwner!, matchingPr!.number);
      if (!result.success) throw new Error(result.error ?? 'Failed to fetch PR details');
      const pr = result.pr;
      if (!pr) throw new Error('PR not found');
      return {
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        url: pr.url,
        isDraft: pr.isDraft,
        updatedAt: pr.updatedAt,
        authorLogin: pr.author?.login ?? null,
        headRefOid: pr.headRefOid,
        state: pr.state,
        reviewDecision: pr.reviewDecision,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        mergeable: pr.mergeable,
        mergeStateStatus: pr.mergeStateStatus,
        body: pr.body,
      } satisfies PullRequestDetails;
    },
    enabled: !!nameWithOwner && !!matchingPr,
    staleTime: 30_000,
    refetchInterval: () => (document.hidden ? false : 30_000),
  });

  const isFeatureBranch = !!branchName && !!defaultBranch && branchName !== defaultBranch;

  // Track last known PR in an effect (not during render)
  useEffect(() => {
    if (matchingPr) {
      setLastKnownPr(matchingPr);
    }
  }, [matchingPr]);

  const isLoading = branchLoading || prsLoading;

  const state = useMemo((): PrSectionState => {
    if (isLoading) return 'loading';
    if (mergedState) return 'merged';
    if (!nameWithOwner) return 'no-remote';
    if (matchingPr) {
      if (matchingPr.state === 'MERGED') return 'merged';
      if (matchingPr.state === 'CLOSED') return 'closed';
      return 'has-pr';
    }
    if (isFeatureBranch) return 'can-create-pr';
    return 'up-to-date';
  }, [isLoading, mergedState, nameWithOwner, matchingPr, isFeatureBranch]);

  const resolvedPr = useMemo((): PullRequestSummary | null => {
    if (matchingPr) {
      if (mergedState && matchingPr.state === 'OPEN') {
        return { ...matchingPr, state: 'MERGED' };
      }
      return matchingPr;
    }
    if ((state === 'merged' || state === 'closed') && lastKnownPr) {
      return mergedState ? { ...lastKnownPr, state: 'MERGED' } : lastKnownPr;
    }
    return null;
  }, [matchingPr, mergedState, state, lastKnownPr]);

  const mergePr = useCallback(
    async (options: { strategy: MergeMode; commitHeadOid?: string }): Promise<MergeResult> => {
      if (!nameWithOwner || !matchingPr) return { success: false, error: 'No PR to merge' };
      try {
        const result = await rpc.github.mergePullRequest(nameWithOwner, matchingPr.number, options);
        if (result.success) {
          setMergedState(true);
          toast({ title: 'PR merged', description: matchingPr.title || `#${matchingPr.number}` });
          return { success: true };
        }
        const error = result.error ?? 'Merge failed';
        toast({ title: 'Merge failed', description: error, variant: 'destructive' });
        return { success: false, error };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Merge failed';
        toast({ title: 'Merge failed', description: error, variant: 'destructive' });
        return { success: false, error };
      }
    },
    [nameWithOwner, matchingPr, toast]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pull-requests', nameWithOwner] });
    queryClient.invalidateQueries({ queryKey: ['pr-details', nameWithOwner] });
  }, [queryClient, nameWithOwner]);

  const value = useMemo<PrContextValue>(
    () => ({
      state,
      nameWithOwner,
      pr: resolvedPr,
      prDetails: prDetailsQuery.data ?? null,
      branchName,
      baseBranch: resolvedPr?.baseRefName ?? defaultBranch ?? null,
      isLoading,
      mergePr,
      refresh,
    }),
    [
      state,
      nameWithOwner,
      resolvedPr,
      prDetailsQuery.data,
      branchName,
      defaultBranch,
      isLoading,
      mergePr,
      refresh,
    ]
  );

  return <PrContext.Provider value={value}>{children}</PrContext.Provider>;
}

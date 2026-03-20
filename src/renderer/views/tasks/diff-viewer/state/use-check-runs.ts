import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rpc } from '@renderer/core/ipc';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/lib/github';

export function useCheckRuns(nameWithOwner?: string, prNumber?: number) {
  const query = useQuery({
    queryKey: ['pr-check-runs', nameWithOwner, prNumber],
    queryFn: async () => {
      const result = await rpc.pullRequests.getCheckRuns(nameWithOwner!, prNumber!);
      if (!result.success) throw new Error(result.error ?? 'Failed to fetch check runs');
      return result.checks as CheckRun[];
    },
    enabled: !!nameWithOwner && !!prNumber,
    staleTime: 10_000,
    refetchInterval: (query) => {
      if (document.hidden) return false;
      const checks = query.state.data;
      if (!checks) return false;
      const hasPending = checks.some((c) => c.bucket === 'pending');
      return hasPending ? 15_000 : 60_000;
    },
  });

  const checks = useMemo(() => query.data ?? [], [query.data]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
    isLoading: query.isLoading,
  };
}

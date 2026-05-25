import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';
import { pullRequestErrorMessage, type PullRequest } from '@shared/pull-requests';

const PENDING_CHECKS_REFETCH_INTERVAL_MS = 5_000;

export function useSyncCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  const checksQuery = useQuery({
    queryKey: ['pull-request-checks-sync', pr.url, pr.headRefOid],
    queryFn: async () => {
      const response = await rpc.pullRequests.syncChecks(pr.url, pr.headRefOid);
      if (!response.success) {
        throw new Error(pullRequestErrorMessage(response.error));
      }
      return response.data;
    },
    refetchInterval: (query) => {
      const hasRunningChecks = query.state.data?.hasRunning === true || summary.pending > 0;
      return hasRunningChecks ? PENDING_CHECKS_REFETCH_INTERVAL_MS : false;
    },
  });

  return {
    checks,
    checksQuery,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}

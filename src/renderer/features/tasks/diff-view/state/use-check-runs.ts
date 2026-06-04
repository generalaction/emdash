import { useEffect, useMemo } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';
import type { PullRequest } from '@shared/pull-requests';

export function useSyncCheckRuns(projectId: string, pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  useEffect(() => {
    void rpc.pullRequests.syncChecks(projectId, pr.url, pr.headRefOid);
  }, [projectId, pr.url, pr.headRefOid]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}

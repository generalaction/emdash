import { useEffect, useMemo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';

export function useCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  useEffect(() => {
    void rpc.pullRequests.syncChecks(pr.url, pr.headRefOid);
  }, [pr.url, pr.headRefOid]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}

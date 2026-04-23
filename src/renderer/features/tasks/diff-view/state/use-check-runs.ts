import { useEffect, useMemo, useState } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';

export function useCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);
  const [isLoading, setIsLoading] = useState(pr.checks.length === 0);

  useEffect(() => {
    setIsLoading(true);
    void rpc.pullRequests.syncChecks(pr.url, pr.headRefOid).finally(() => {
      setIsLoading(false);
    });
  }, [pr.url, pr.headRefOid]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
    isLoading,
  };
}

import { useMemo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';

export function useCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
    isLoading: false,
  };
}

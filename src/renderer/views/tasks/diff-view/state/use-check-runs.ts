import { useMemo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/lib/github';
import { useRequireProvisionedTask } from '../../task-view-context';

export function useCheckRuns(pr: PullRequest) {
  const prStore = useRequireProvisionedTask().pr;
  const resource = prStore.getCheckRuns(pr);

  const checks = useMemo(
    () => (resource.data ?? []) as CheckRun[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.data]
  );
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
    isLoading: resource.loading,
  };
}

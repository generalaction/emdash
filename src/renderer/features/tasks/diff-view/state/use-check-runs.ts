import { useMemo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';

export function useCheckRuns(pr: PullRequest) {
  const prStore = useProvisionedTask().workspace.pr;
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

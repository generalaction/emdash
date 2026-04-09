import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';

/**
 * Reads the task's commit history from PrStore.commitHistory.
 * The Resource uses a 'demand' strategy — it loads on first observation and
 * stays cached as long as the task is provisioned.
 */
export function useCommitHistory() {
  const prStore = useProvisionedTask().workspace.pr;
  const resource = prStore.commitHistory;

  return {
    isLoading: resource.loading,
    commits: resource.data?.commits ?? [],
    aheadCount: resource.data?.aheadCount ?? 0,
  };
}

import type { PullRequest } from '@shared/pull-requests';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';

export function usePrComments(pr: PullRequest) {
  const prStore = useProvisionedTask().workspace.pr;
  const resource = prStore.getComments(pr);

  return {
    comments: resource.data ?? [],
    isLoading: resource.loading,
    addComment: (body: string) => prStore.addComment(pr, body),
    isAddingComment: false,
  };
}

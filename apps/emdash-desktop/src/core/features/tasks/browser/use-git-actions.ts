import { useMutation } from '@tanstack/react-query';
import { getGitRepositoryStore } from '@core/features/projects/browser/stores/project-selectors';
import {
  getTaskGitCheckoutStore,
  getTaskStore,
} from '@core/features/tasks/browser/stores/task-selectors';
import { runGitFetch, runGitPublishBranch, runGitPull, runGitPush } from './git-action-handlers';

export function useGitActions(projectId: string, taskId: string) {
  const git = getTaskGitCheckoutStore(projectId, taskId)!;
  const repository = getGitRepositoryStore(projectId)!;
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId ?? undefined;

  const hasUpstream = git?.isBranchPublished;

  const gitFetchMutation = useMutation({
    mutationFn: () => runGitFetch(repository),
  });

  const gitPullMutation = useMutation({
    mutationFn: () => runGitPull(git),
  });

  const gitPushMutation = useMutation({
    mutationFn: () => runGitPush(git),
  });

  const gitPublishMutation = useMutation({
    mutationFn: () => runGitPublishBranch({ repository, branchName: git.branchName, workspaceId }),
  });

  return {
    hasUpstream,
    aheadCount: git.aheadCount,
    behindCount: git.behindCount,
    publish: () => gitPublishMutation.mutate(),
    isPublishing: gitPublishMutation.isPending,
    fetch: () => gitFetchMutation.mutate(),
    isFetching: gitFetchMutation.isPending,
    pull: () => gitPullMutation.mutate(),
    isPulling: gitPullMutation.isPending,
    push: () => gitPushMutation.mutate(),
    isPushing: gitPushMutation.isPending,
  };
}

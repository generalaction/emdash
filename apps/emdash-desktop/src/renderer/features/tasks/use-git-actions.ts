import { useMutation } from '@tanstack/react-query';
import { getGitRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import {
  getTaskGitWorktreeStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { runGitFetch, runGitPublishBranch, runGitPull, runGitPush } from './git-action-handlers';

export function useGitActions(projectId: string, taskId: string) {
  const git = getTaskGitWorktreeStore(projectId, taskId)!;
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

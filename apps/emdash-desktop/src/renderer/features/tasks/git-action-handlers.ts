import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import type { GitWorktreeStore } from '@renderer/features/tasks/stores/git-worktree-store';
import { toast } from '@renderer/lib/hooks/use-toast';
import { formatErrorType, formatPushErrorDetail } from './utils';

export async function runGitFetch(repository: GitRepositoryStore) {
  const result = await repository.fetchRemote();
  if (!result.success) {
    toast({
      title: `Failed to fetch remote changes: ${formatErrorType(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

export async function runGitPull(git: GitWorktreeStore) {
  const result = await git.pull();
  if (!result.success) {
    toast({
      title: `Failed to pull changes: ${formatErrorType(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

export async function runGitPush(git: GitWorktreeStore) {
  const result = await git.push();
  if (!result.success) {
    toast({
      title: `Failed to push: ${formatPushErrorDetail(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

export async function runGitPublishBranch({
  repository,
  branchName,
  workspaceId,
}: {
  repository: GitRepositoryStore;
  branchName: string | null | undefined;
  workspaceId?: string;
}) {
  if (!branchName) {
    toast({
      title: 'Failed to publish branch: No branch checked out',
      variant: 'destructive',
    });
    return undefined;
  }

  const result = await repository.publishBranch(branchName, workspaceId);
  if (!result.success) {
    toast({
      title: `Failed to publish branch: ${formatPushErrorDetail(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

import { formatErrorType, formatPushErrorDetail } from '@core/features/tasks/browser/utils';
import { toast } from '@renderer/lib/hooks/use-toast';
import type { GitCheckoutStore } from './stores/git-checkout-store';
import type { GitRepositoryStore } from './stores/git-repository-store';

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

export async function runGitPull(git: GitCheckoutStore) {
  const result = await git.pull();
  if (!result.success) {
    toast({
      title: `Failed to pull changes: ${formatErrorType(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

export async function runGitPush(git: GitCheckoutStore) {
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

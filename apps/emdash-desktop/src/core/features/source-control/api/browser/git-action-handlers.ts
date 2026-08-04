import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import {
  formatFetchErrorDetail,
  formatPullErrorDetail,
  formatPushErrorDetail,
} from '@core/features/source-control/api/git-error-messages';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type { GitCheckoutStore } from '../../browser/stores/git-checkout-store';

export async function runGitFetch(repository: GitRepositoryStore) {
  const result = await repository.fetchRemote();
  if (!result.success) {
    toast({
      title: `Failed to fetch remote changes: ${formatFetchErrorDetail(result.error)}`,
      variant: 'destructive',
    });
  }
  return result;
}

export async function runGitPull(git: GitCheckoutStore) {
  const result = await git.pull();
  if (!result.success) {
    toast({
      title: `Failed to pull changes: ${formatPullErrorDetail(result.error)}`,
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

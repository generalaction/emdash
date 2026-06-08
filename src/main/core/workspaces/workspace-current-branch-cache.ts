import { eq } from 'drizzle-orm';
import type { WorkspaceGitProvider } from '@main/core/git/workspace-git-provider';
import { db } from '@main/db/client';
import { workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';

export type WorkspaceCurrentBranchCacheRefresh =
  | {
      branchName: string | null;
      changed: boolean;
    }
  | undefined;

export async function refreshWorkspaceCurrentBranchCache(
  workspaceId: string,
  git: WorkspaceGitProvider
): Promise<WorkspaceCurrentBranchCacheRefresh> {
  try {
    const branchName = await git.getCurrentBranch();
    const [workspace] = await db
      .select({ branchName: workspaces.branchName })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) {
      log.warn('Failed to refresh workspace current branch cache: workspace not found', {
        workspaceId,
      });
      return undefined;
    }

    if (workspace.branchName === branchName) {
      return { branchName, changed: false };
    }

    await db.update(workspaces).set({ branchName }).where(eq(workspaces.id, workspaceId));
    return { branchName, changed: true };
  } catch (e) {
    log.warn('Failed to refresh workspace current branch cache', {
      workspaceId,
      error: String(e),
    });
    return undefined;
  }
}

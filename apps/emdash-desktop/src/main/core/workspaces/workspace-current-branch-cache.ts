import { eq } from 'drizzle-orm';
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
  readCurrentBranch: () => Promise<string | null>
): Promise<WorkspaceCurrentBranchCacheRefresh> {
  try {
    const branchName = await readCurrentBranch();
    const [workspace] = await db
      .select({
        branchName: workspaces.branchName,
        config: workspaces.config,
        kind: workspaces.kind,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) {
      log.warn('Failed to refresh workspace current branch cache: workspace not found', {
        workspaceId,
      });
      return undefined;
    }

    if (!workspace.config && workspace.kind !== 'project-root') {
      return { branchName: workspace.branchName, changed: false };
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

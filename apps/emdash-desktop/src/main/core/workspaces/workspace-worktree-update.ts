import type { GitHeadModel, GitStatusModel, GitWorktreeUpdate } from '@emdash/shared/git';
import { eq } from 'drizzle-orm';
import { refreshWorkspaceCurrentBranchCache } from '@main/core/workspaces/workspace-current-branch-cache';
import { db } from '@main/db/client';
import { workspaces as workspacesTable } from '@main/db/schema';
import { log } from '@main/lib/logger';

function branchNameFromHead(model: GitHeadModel): string | null {
  return model.kind === 'detached' ? null : model.name;
}

export function handleGitWorktreeUpdate(
  workspaceId: string,
  update: GitWorktreeUpdate,
  emit: (update: GitWorktreeUpdate) => void
): void {
  if (update.kind === 'head') {
    void refreshWorkspaceCurrentBranchCache(workspaceId, () =>
      Promise.resolve(branchNameFromHead(update.model))
    ).finally(() => {
      try {
        emit(update);
      } catch (e) {
        log.warn('Failed to emit git worktree head update', { workspaceId, error: String(e) });
      }
    });
    return;
  }
  emit(update);
  if (update.kind === 'status' && update.model.kind === 'ok') {
    void cacheWorkspaceLineStats(workspaceId, update.model);
  }
}

async function cacheWorkspaceLineStats(
  workspaceId: string,
  status: Extract<GitStatusModel, { kind: 'ok' }>
): Promise<void> {
  let unstagedAdded = 0;
  let unstagedDeleted = 0;
  for (const c of status.unstaged) {
    unstagedAdded += c.additions;
    unstagedDeleted += c.deletions;
  }
  try {
    await db
      .update(workspacesTable)
      .set({
        linesAdded: status.stagedAdded + unstagedAdded,
        linesDeleted: status.stagedDeleted + unstagedDeleted,
      })
      .where(eq(workspacesTable.id, workspaceId));
  } catch (e) {
    log.warn('Failed to cache workspace git status', { workspaceId, error: String(e) });
  }
}

import { fromStoredBranch } from '@main/core/tasks/stored-branch';
import type { GitSetup, WorkspaceLocation } from '@shared/tasks';
import type { WorkspaceType } from '@shared/workspaces';

type TaskRow = {
  workspaceIntent: string | null | undefined;
  taskBranch: string | null | undefined;
  sourceBranch: unknown;
  workspaceProvider: string | null | undefined;
};

type WorkspaceRow = {
  type: WorkspaceType;
  path: string | null | undefined;
};

export type WorkspaceIntent = {
  git: GitSetup;
  workspace: WorkspaceLocation;
};

/**
 * Derives the workspace intent (`GitSetup` + `WorkspaceLocation`) for a task.
 *
 * For tasks created after the `workspace_intent` migration, this simply
 * deserialises the stored JSON.  For legacy tasks it infers intent from the
 * old `taskBranch`, `sourceBranch`, and `workspaceProvider` columns.
 *
 * Returns `null` when neither source of truth is available (should not happen
 * for valid task rows, but callers must handle it gracefully).
 *
 * This is a retrieval-path compatibility helper — never use it for backfills.
 */
export function resolveWorkspaceIntent(
  taskRow: TaskRow,
  workspaceRow: WorkspaceRow
): WorkspaceIntent | null {
  // Prefer the stored intent if present.
  if (taskRow.workspaceIntent) {
    try {
      return JSON.parse(taskRow.workspaceIntent) as WorkspaceIntent;
    } catch {
      // Fall through to legacy inference.
    }
  }

  return inferLegacyIntent(taskRow, workspaceRow);
}

function inferLegacyIntent(taskRow: TaskRow, workspaceRow: WorkspaceRow): WorkspaceIntent | null {
  // BYOI workspaces use a dedicated provision path — return an intent that
  // signals no git setup is needed; the BYOI flow handles the rest.
  if (workspaceRow.type === 'byoi' || taskRow.workspaceProvider === 'byoi') {
    return {
      git: { kind: 'none' },
      workspace: { host: 'byoi' },
    };
  }

  const host = workspaceRow.type === 'project-ssh' ? 'project-ssh' : 'local';

  // If a path is already stored, the workspace exists at that location.
  if (workspaceRow.path) {
    return {
      git: { kind: 'none' },
      workspace: { host, path: workspaceRow.path },
    };
  }

  // No taskBranch means the task uses the project root.
  if (!taskRow.taskBranch) {
    return {
      git: { kind: 'none' },
      workspace: { host },
    };
  }

  const taskBranch = taskRow.taskBranch;
  const sourceBranch = fromStoredBranch(taskRow.sourceBranch as string | null);

  // When taskBranch matches sourceBranch, the legacy code used
  // `checkoutExistingBranch` — map to `use-branch`.
  if (sourceBranch && sourceBranch.branch === taskBranch) {
    return {
      git: { kind: 'use-branch', branchName: taskBranch },
      workspace: { host },
    };
  }

  // Otherwise the branch was created from sourceBranch — map to `create-branch`.
  // If sourceBranch is unavailable we still use `use-branch` as a safe fallback
  // since the branch already exists in the repo.
  if (!sourceBranch) {
    return {
      git: { kind: 'use-branch', branchName: taskBranch },
      workspace: { host },
    };
  }

  return {
    git: {
      kind: 'create-branch',
      branchName: taskBranch,
      fromBranch: sourceBranch,
    },
    workspace: { host },
  };
}

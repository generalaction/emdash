import { fromStoredBranch } from '@main/core/tasks/stored-branch';
import type { GitSetup, WorkspaceLocation } from '@shared/tasks';
import { parseWorkspaceConfig } from '@shared/workspace-config';
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
  config?: string | null | undefined;
};

export type WorkspaceIntent = {
  git: GitSetup;
  workspace: WorkspaceLocation;
};

/**
 * Derives the workspace intent (`GitSetup` + `WorkspaceLocation`) for a task.
 *
 * Priority:
 * 1. `workspaceRow.config` — written by `createTask` for all new tasks.
 * 2. `taskRow.workspaceIntent` — written by the previous migration; kept for
 *    tasks created before the `workspaces.config` column existed.
 * 3. Legacy inference from `taskBranch`, `sourceBranch`, and `workspaceProvider`.
 *
 * Returns `null` when none of the sources are available (should not happen for
 * valid task rows, but callers must handle it gracefully).
 *
 * This is a retrieval-path compatibility helper — never use it for backfills.
 */
export function resolveWorkspaceIntent(
  taskRow: TaskRow,
  workspaceRow: WorkspaceRow
): WorkspaceIntent | null {
  // 1. Prefer the workspace-level config if present (new path).
  if (workspaceRow.config) {
    const cfg = parseWorkspaceConfig(workspaceRow.config);
    if (cfg) return { git: cfg.git, workspace: cfg.workspace };
  }

  // 2. Fall back to the task-level intent (previous migration path).
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

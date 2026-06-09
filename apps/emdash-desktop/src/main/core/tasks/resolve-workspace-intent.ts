import type { GitSetup, WorkspaceLocation } from '@shared/core/tasks/tasks';
import type { WorkspaceConfig, WorkspaceTarget } from '@shared/core/workspaces/workspace-config';
import type { WorkspaceType } from '@shared/core/workspaces/workspaces';

/**
 * Derives the effective branch name from a `GitSetup` intent — no git I/O.
 * Returns `null` for setups that do not involve a branch.
 */
export function deriveBranchName(git: GitSetup): string | null {
  switch (git.kind) {
    case 'none':
      return null;
    case 'use-branch':
      return git.branchName;
    case 'create-branch':
      return git.branchName;
    case 'pr-branch':
      return git.taskBranch ?? git.headBranch;
  }
}

type TaskRow = {
  workspaceIntent: string | null | undefined;
  workspaceProvider: string | null | undefined;
};

type WorkspaceRow = {
  type: WorkspaceType;
  path: string | null | undefined;
  config?: WorkspaceConfig | null | undefined;
  branchName?: string | null | undefined;
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
 * 3. Legacy inference from `workspaceRow.branchName` and `workspaceProvider`.
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
    const cfg = workspaceRow.config;
    const workspace = workspaceTargetToLocation(cfg.workspace, workspaceRow.type);
    if (workspace) return { git: cfg.git, workspace };
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

/**
 * Converts a v2 `WorkspaceTarget` to the legacy `WorkspaceLocation` type needed by
 * `compileSetupSpec`. Used only in the backwards-compat read path.
 *
 * Returns `null` for `repository-instance` targets — those are handled by the
 * `project-root` fast-path in `WorkspaceBootstrapService` before this code is reached.
 */
function workspaceTargetToLocation(
  target: WorkspaceTarget,
  workspaceType: WorkspaceType
): WorkspaceLocation | null {
  if (target.kind === 'repository-instance') return null;
  if (target.kind === 'byoi') return { host: 'byoi' };
  // 'new-worktree' — derive host from the legacy workspace type column.
  const host = workspaceType === 'project-ssh' ? 'project-ssh' : 'local';
  return { host };
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

  // No branchName means the task uses the project root.
  if (!workspaceRow.branchName) {
    return {
      git: { kind: 'none' },
      workspace: { host },
    };
  }

  const branchName = workspaceRow.branchName;

  // For legacy rows we can only infer use-branch since we no longer store sourceBranch.
  return {
    git: { kind: 'use-branch', branchName },
    workspace: { host },
  };
}

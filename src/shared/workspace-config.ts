import type { GitSetup, WorkspaceLocation } from '@shared/tasks';

// ---------------------------------------------------------------------------
// v2 — WorkspaceTarget describes how a task relates to its workspace.
// ---------------------------------------------------------------------------

export type WorkspaceTarget =
  | { kind: 'repository-instance'; workspaceId: string }
  | { kind: 'new-worktree' }
  | { kind: 'byoi'; remoteWorkspaceId?: string };

export type WorkspaceConfig = {
  version: '2';
  git: GitSetup;
  workspace: WorkspaceTarget;
};

// ---------------------------------------------------------------------------
// v1 legacy — stored in workspaces.config and automations.task_config rows
// created before the v2 schema. Kept internal; callers receive WorkspaceConfig.
// ---------------------------------------------------------------------------

type WorkspaceConfigV1 = {
  version: '1';
  git: GitSetup;
  workspace: WorkspaceLocation;
};

/**
 * Upgrades a parsed v1 config to v2 where possible.
 * `git.kind === 'none'` cannot be upgraded without knowing the project's
 * repositoryWorkspaceId — callers that need the full v2 type must handle
 * the null return for that case.
 */
function upgradeV1(v1: WorkspaceConfigV1): WorkspaceConfig | null {
  const { git, workspace } = v1;
  if (workspace.host === 'byoi') {
    return {
      version: '2',
      git,
      workspace: { kind: 'byoi', remoteWorkspaceId: workspace.remoteWorkspaceId },
    };
  }
  if (git.kind === 'none') {
    // Cannot determine the repositoryWorkspaceId here — caller must resolve.
    return null;
  }
  return { version: '2', git, workspace: { kind: 'new-worktree' } };
}

export function parseWorkspaceConfig(raw: string | null | undefined): WorkspaceConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const version = (parsed as { version?: unknown }).version;

    if (version === '2') return parsed as WorkspaceConfig;

    if (version === '1') return upgradeV1(parsed as WorkspaceConfigV1);

    return null;
  } catch {
    return null;
  }
}

export function serializeWorkspaceConfig(config: WorkspaceConfig): string {
  return JSON.stringify(config);
}

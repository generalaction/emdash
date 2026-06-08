import { describe, expect, it } from 'vitest';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import { getProvisionedWorkspaceBranch } from './workspace-branch';

const createBranchConfig: WorkspaceConfig = {
  version: '2',
  git: {
    kind: 'create-branch',
    branchName: 'task/provisioned',
    fromBranch: { type: 'local', branch: 'main' },
  },
  workspace: { kind: 'new-worktree' },
};

describe('workspace branch metadata', () => {
  it('treats project-root branchName as current branch cache, not provisioned branch', () => {
    const workspace = {
      kind: 'project-root' as const,
      branchName: 'feature/current',
      config: null,
    };

    expect(getProvisionedWorkspaceBranch(workspace)).toBeNull();
  });

  it('derives provisioned worktree branch from config before branchName cache', () => {
    expect(
      getProvisionedWorkspaceBranch({
        kind: 'worktree',
        branchName: 'feature/current',
        config: createBranchConfig,
      })
    ).toBe('task/provisioned');
  });

  it('does not treat a worktree row with git none as owning a branch', () => {
    const config: WorkspaceConfig = {
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'new-worktree' },
    };

    expect(
      getProvisionedWorkspaceBranch({
        kind: 'worktree',
        branchName: 'feature/current',
        config,
      })
    ).toBeNull();
  });

  it('keeps branchName as legacy fallback when kind and config are missing', () => {
    expect(
      getProvisionedWorkspaceBranch({
        kind: null,
        branchName: 'legacy/task-branch',
        config: null,
      })
    ).toBe('legacy/task-branch');
  });
});

import { describe, expect, it } from 'vitest';
import { describeSetupSteps } from './describe-setup-steps';
import type { WorkspaceSetupStep } from './workspace-setup-steps';

describe('describeSetupSteps', () => {
  it('returns empty array for no steps', () => {
    expect(describeSetupSteps([])).toEqual([]);
  });

  it('git-fetch without refspec', () => {
    const step: WorkspaceSetupStep = { kind: 'git-fetch', args: { remote: 'origin' } };
    expect(describeSetupSteps([step])).toEqual(['Fetch from origin']);
  });

  it('git-fetch with refspec', () => {
    const step: WorkspaceSetupStep = {
      kind: 'git-fetch',
      args: { remote: 'origin', refspec: 'refs/pull/42/head:refs/heads/pr-42' },
    };
    expect(describeSetupSteps([step])).toEqual([
      'Fetch refs/pull/42/head:refs/heads/pr-42 from origin',
    ]);
  });

  it('ensure-remote', () => {
    const step: WorkspaceSetupStep = {
      kind: 'ensure-remote',
      args: { name: 'fork', url: 'https://github.com/fork/repo' },
    };
    expect(describeSetupSteps([step])).toEqual([
      'Add remote "fork" → https://github.com/fork/repo',
    ]);
  });

  it('create-local-branch', () => {
    const step: WorkspaceSetupStep = {
      kind: 'create-local-branch',
      args: { branchName: 'feat/x', fromRef: 'origin/main', noTrack: true },
    };
    expect(describeSetupSteps([step])).toEqual(['Create branch "feat/x" from origin/main']);
  });

  it('set-branch-tracking', () => {
    const step: WorkspaceSetupStep = {
      kind: 'set-branch-tracking',
      args: { branchName: 'feat/x', remote: 'origin', remoteBranch: 'feat/x' },
    };
    expect(describeSetupSteps([step])).toEqual(['Track origin/feat/x for "feat/x"']);
  });

  it('set-branch-base', () => {
    const step: WorkspaceSetupStep = {
      kind: 'set-branch-base',
      args: { branchName: 'feat/x', baseRef: 'origin/main' },
    };
    expect(describeSetupSteps([step])).toEqual(['Set merge base for "feat/x" to origin/main']);
  });

  it('push-branch without setUpstream', () => {
    const step: WorkspaceSetupStep = {
      kind: 'push-branch',
      args: { branchName: 'feat/x', remote: 'origin' },
    };
    expect(describeSetupSteps([step])).toEqual(['Push "feat/x" to origin']);
  });

  it('push-branch with setUpstream', () => {
    const step: WorkspaceSetupStep = {
      kind: 'push-branch',
      args: { branchName: 'feat/x', remote: 'origin', setUpstream: true },
    };
    expect(describeSetupSteps([step])).toEqual(['Push "feat/x" to origin (set upstream)']);
  });

  it('add-worktree', () => {
    const step: WorkspaceSetupStep = {
      kind: 'add-worktree',
      args: { branchName: 'feat/x' },
    };
    expect(describeSetupSteps([step])).toEqual(['Create worktree for branch "feat/x"']);
  });

  it('copy-preserved-files', () => {
    const step: WorkspaceSetupStep = { kind: 'copy-preserved-files', args: {} };
    expect(describeSetupSteps([step])).toEqual(['Copy preserved project files into the worktree']);
  });

  it('produces descriptions for a full new-branch sequence', () => {
    const steps: WorkspaceSetupStep[] = [
      {
        kind: 'create-local-branch',
        args: { branchName: 'feat/x', fromRef: 'main', noTrack: true },
      },
      { kind: 'set-branch-base', args: { branchName: 'feat/x', baseRef: 'main' } },
      { kind: 'add-worktree', args: { branchName: 'feat/x' } },
      { kind: 'copy-preserved-files', args: {} },
      { kind: 'push-branch', args: { branchName: 'feat/x', remote: 'origin', setUpstream: true } },
    ];
    const result = describeSetupSteps(steps);
    expect(result).toHaveLength(5);
    expect(result[0]).toContain('Create branch');
    expect(result[2]).toContain('worktree');
    expect(result[4]).toContain('set upstream');
  });
});

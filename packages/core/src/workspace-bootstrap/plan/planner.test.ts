import { describe, expect, it } from 'vitest';
import type { BootstrapContext } from '../api/schemas';
import type { BootstrapGitIntent } from './intent';
import { compileBootstrapPlan } from './planner';

const context: BootstrapContext = {
  repoPath: '/repo',
  worktreePoolPath: '/repo-worktrees',
  baseRemote: 'origin',
  pushRemote: 'fork',
  preservePatterns: [],
};

describe('compileBootstrapPlan', () => {
  it('plans a use-branch workspace', () => {
    const plan = compileBootstrapPlan({ kind: 'use-branch', branchName: 'feature' }, context);

    expect(plan.steps.map((entry) => entry.step)).toEqual([
      { kind: 'add-worktree', args: { branchName: 'feature' } },
      { kind: 'copy-preserved-files', args: {} },
    ]);
    expect(plan.steps.map((entry) => entry.id)).toEqual([
      'add-worktree:1',
      'copy-preserved-files:1',
    ]);
  });

  it('plans create-branch from a remote source with push', () => {
    const intent: BootstrapGitIntent = {
      kind: 'create-branch',
      branchName: 'task-branch',
      fromBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://example.com/repo.git' },
      },
      pushBranch: true,
    };

    const plan = compileBootstrapPlan(intent, context);

    expect(plan.steps.map((entry) => entry.step)).toEqual([
      { kind: 'git-fetch', args: { remote: 'origin' } },
      {
        kind: 'create-local-branch',
        args: { branchName: 'task-branch', fromRef: 'origin/main', noTrack: true },
      },
      { kind: 'set-branch-base', args: { branchName: 'task-branch', baseRef: 'origin/main' } },
      { kind: 'add-worktree', args: { branchName: 'task-branch' } },
      { kind: 'copy-preserved-files', args: {} },
      {
        kind: 'push-branch',
        args: { branchName: 'task-branch', remote: 'fork', setUpstream: true },
      },
    ]);
  });

  it('plans create-branch from a local source', () => {
    const plan = compileBootstrapPlan(
      {
        kind: 'create-branch',
        branchName: 'task-branch',
        fromBranch: { type: 'local', branch: 'main' },
      },
      context
    );

    expect(plan.steps.map((entry) => entry.step.kind)).toEqual([
      'create-local-branch',
      'set-branch-base',
      'add-worktree',
      'copy-preserved-files',
    ]);
  });

  it('plans a fork pull request with a task branch', () => {
    const plan = compileBootstrapPlan(
      {
        kind: 'pr-branch',
        prNumber: 42,
        headBranch: 'contributor/topic',
        headRepositoryUrl: 'git@github.com:contributor/repo.git',
        isFork: true,
        taskBranch: 'task/pr-42',
        pushBranch: true,
      },
      context
    );

    expect(plan.steps.map((entry) => entry.step)).toEqual([
      {
        kind: 'ensure-remote',
        args: { name: 'contributor', url: 'git@github.com:contributor/repo.git' },
      },
      {
        kind: 'git-fetch',
        args: {
          remote: 'contributor',
          refspec: 'contributor/topic:refs/heads/contributor/topic',
          force: true,
        },
      },
      {
        kind: 'set-branch-tracking',
        args: {
          branchName: 'contributor/topic',
          remote: 'contributor',
          remoteBranch: 'contributor/topic',
        },
      },
      {
        kind: 'create-local-branch',
        args: { branchName: 'task/pr-42', fromRef: 'contributor/topic', noTrack: true },
      },
      { kind: 'add-worktree', args: { branchName: 'task/pr-42' } },
      { kind: 'copy-preserved-files', args: {} },
      { kind: 'push-branch', args: { branchName: 'task/pr-42', remote: 'fork' } },
    ]);
  });

  it('plans a same-repo pull request without a task branch', () => {
    const plan = compileBootstrapPlan(
      {
        kind: 'pr-branch',
        prNumber: 42,
        headBranch: 'feature',
        headRepositoryUrl: 'https://example.com/repo.git',
        isFork: false,
      },
      context
    );

    expect(plan.steps.map((entry) => entry.step.kind)).toEqual([
      'git-fetch',
      'set-branch-tracking',
      'add-worktree',
      'copy-preserved-files',
    ]);
    expect(plan.steps[0].step).toEqual({
      kind: 'git-fetch',
      args: {
        remote: 'origin',
        refspec: 'refs/pull/42/head:refs/heads/feature',
        force: true,
      },
    });
  });
});

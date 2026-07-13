import { describe, expect, it } from 'vitest';
import type { BootstrapGitIntent } from './intent';
import { compileBootstrapPlan } from './planner';

const options = {
  worktreePoolPath: '/repo-worktrees',
  baseRemote: 'origin',
};

describe('compileBootstrapPlan', () => {
  it('plans a use-branch workspace', () => {
    const compiled = compileBootstrapPlan({ kind: 'use-branch', branchName: 'feature' }, options);

    expect(compiled.workspacePath).toBe('/repo-worktrees/feature');
    expect(compiled.plan.steps.map((entry) => entry.step)).toEqual([
      { kind: 'add-worktree', args: { branchName: 'feature', path: '/repo-worktrees/feature' } },
      { kind: 'copy-preserved-files', args: {} },
    ]);
    expect(compiled.plan.steps.map((entry) => entry.id)).toEqual([
      'add-worktree:1',
      'copy-preserved-files:1',
    ]);
  });

  it('plans create-branch from a remote source', () => {
    const intent: BootstrapGitIntent = {
      kind: 'create-branch',
      branchName: 'task-branch',
      fromBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://example.com/repo.git' },
      },
    };

    const compiled = compileBootstrapPlan(intent, options);

    expect(compiled.workspacePath).toBe('/repo-worktrees/task-branch');
    expect(compiled.plan.steps.map((entry) => entry.step)).toEqual([
      {
        kind: 'git-fetch',
        args: {
          remote: 'origin',
          refspec: '+refs/heads/main:refs/remotes/origin/main',
        },
      },
      {
        kind: 'create-local-branch',
        args: { branchName: 'task-branch', fromRef: 'origin/main', noTrack: true },
      },
      { kind: 'set-branch-base', args: { branchName: 'task-branch', baseRef: 'origin/main' } },
      {
        kind: 'add-worktree',
        args: { branchName: 'task-branch', path: '/repo-worktrees/task-branch' },
      },
      { kind: 'copy-preserved-files', args: {} },
    ]);
  });

  it('plans create-branch from a local source', () => {
    const compiled = compileBootstrapPlan(
      {
        kind: 'create-branch',
        branchName: 'task-branch',
        fromBranch: { type: 'local', branch: 'main' },
      },
      options
    );

    expect(compiled.plan.steps.map((entry) => entry.step.kind)).toEqual([
      'create-local-branch',
      'set-branch-base',
      'add-worktree',
      'copy-preserved-files',
    ]);
  });

  it('plans a fork pull request with a task branch', () => {
    const compiled = compileBootstrapPlan(
      {
        kind: 'pr-branch',
        prNumber: 42,
        headBranch: 'contributor/topic',
        headRepositoryUrl: 'git@github.com:contributor/repo.git',
        isFork: true,
        taskBranch: 'task/pr-42',
      },
      options
    );

    expect(compiled.workspacePath).toBe('/repo-worktrees/task-pr-42');
    expect(compiled.plan.steps.map((entry) => entry.step)).toEqual([
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
      {
        kind: 'add-worktree',
        args: { branchName: 'task/pr-42', path: '/repo-worktrees/task-pr-42' },
      },
      { kind: 'copy-preserved-files', args: {} },
    ]);
  });

  it('plans a same-repo pull request without a task branch', () => {
    const compiled = compileBootstrapPlan(
      {
        kind: 'pr-branch',
        prNumber: 42,
        headBranch: 'feature',
        headRepositoryUrl: 'https://example.com/repo.git',
        isFork: false,
      },
      options
    );

    expect(compiled.workspacePath).toBe('/repo-worktrees/feature');
    expect(compiled.plan.steps.map((entry) => entry.step.kind)).toEqual([
      'git-fetch',
      'set-branch-tracking',
      'add-worktree',
      'copy-preserved-files',
    ]);
    expect(compiled.plan.steps[0].step).toEqual({
      kind: 'git-fetch',
      args: {
        remote: 'origin',
        refspec: 'refs/pull/42/head:refs/heads/feature',
        force: true,
      },
    });
  });

  it('plans clone and directory workspaces', () => {
    const clone = compileBootstrapPlan(
      { kind: 'clone-repository', url: 'file:///repo.git', destination: '/workspace/repo' },
      options
    );
    expect(clone).toMatchObject({
      workspacePath: '/workspace/repo',
      plan: {
        steps: [
          {
            step: { kind: 'git-clone', args: { url: 'file:///repo.git', path: '/workspace/repo' } },
          },
        ],
      },
    });

    const directory = compileBootstrapPlan(
      { kind: 'plain-directory', path: '/workspace/plain' },
      options
    );
    expect(directory).toMatchObject({
      workspacePath: '/workspace/plain',
      plan: { steps: [{ step: { kind: 'create-directory', args: { path: '/workspace/plain' } } }] },
    });
  });
});

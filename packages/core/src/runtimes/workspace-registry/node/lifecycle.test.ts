import { describe, expect, it } from 'vitest';
import type { CreateWorktreeInput } from '../api/schemas';
import { buildCreationLifecycle, withLifecycleStep } from './lifecycle';

const input: CreateWorktreeInput = {
  workspaceId: 'ws-1',
  repositoryId: 'repo-1',
  branch: 'feature/x',
  baseRef: 'origin/main',
  path: '/tmp/wt',
  preservePatterns: ['.env'],
  pushBranch: true,
};

describe('buildCreationLifecycle', () => {
  it('a fresh creation with a base fetch yields the full step sequence in order', () => {
    const lifecycle = buildCreationLifecycle(
      input,
      { status: 'succeeded', finalPath: '/tmp/wt', createdWorktree: true, createdBranch: true },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'resolve-base', at: 120 },
        { stage: 'fetch-base', at: 130 },
        { stage: 'add-worktree', at: 400 },
        { stage: 'verify', at: 500 },
      ],
      600
    );
    expect(lifecycle.preservePatterns).toEqual(['.env']);
    expect(lifecycle.steps).toEqual([
      {
        id: 'fetch-remote-base',
        status: 'succeeded',
        startedAt: 130,
        finishedAt: 400,
        params: { base: 'origin/main' },
      },
      {
        id: 'create-worktree',
        status: 'succeeded',
        startedAt: 400,
        finishedAt: 600,
        params: { path: '/tmp/wt', branch: 'feature/x', branchCreated: true },
      },
      { id: 'copy-artifacts', status: 'pending', startedAt: null, finishedAt: null, params: {} },
      {
        id: 'push-branch',
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        params: { branch: 'feature/x' },
      },
      {
        id: 'fetch-refs',
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        params: { base: 'origin/main' },
      },
    ]);
  });

  it('a locally-resolvable base yields no fetch-remote-base step', () => {
    const lifecycle = buildCreationLifecycle(
      { ...input, pushBranch: false },
      { status: 'succeeded', finalPath: '/tmp/wt', createdWorktree: true, createdBranch: false },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'resolve-base', at: 120 },
        { stage: 'add-worktree', at: 150 },
        { stage: 'verify', at: 200 },
      ],
      250
    );
    expect(lifecycle.steps.map((step) => step.id)).toEqual([
      'create-worktree',
      'copy-artifacts',
      'fetch-refs',
    ]);
  });

  it('no preservePatterns yields no copy-artifacts step at all', () => {
    const lifecycle = buildCreationLifecycle(
      { ...input, preservePatterns: [], pushBranch: false },
      { status: 'succeeded', finalPath: '/tmp/wt', createdWorktree: true, createdBranch: true },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'add-worktree', at: 150 },
        { stage: 'verify', at: 200 },
      ],
      250
    );
    expect(lifecycle.steps.map((step) => step.id)).toEqual(['create-worktree', 'fetch-refs']);
  });

  it('adopting an existing worktree yields adopt-worktree and no copy-artifacts', () => {
    const lifecycle = buildCreationLifecycle(
      { ...input, pushBranch: false },
      { status: 'succeeded', finalPath: '/tmp/wt', createdWorktree: false, createdBranch: false },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'verify', at: 150 },
      ],
      200
    );
    expect(lifecycle.steps.map((step) => step.id)).toEqual(['adopt-worktree', 'fetch-refs']);
    expect(lifecycle.steps[0]).toMatchObject({
      status: 'succeeded',
      params: { branch: 'feature/x', path: '/tmp/wt' },
    });
  });

  it('a failed add-worktree lands as a failed create-worktree step after a good fetch', () => {
    const lifecycle = buildCreationLifecycle(
      input,
      { status: 'failed', stage: 'add-worktree', message: 'invalid reference' },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'resolve-base', at: 120 },
        { stage: 'fetch-base', at: 130 },
        { stage: 'add-worktree', at: 400 },
      ],
      450
    );
    expect(lifecycle.steps).toEqual([
      {
        id: 'fetch-remote-base',
        status: 'succeeded',
        startedAt: 130,
        finishedAt: 400,
        params: { base: 'origin/main' },
      },
      {
        id: 'create-worktree',
        status: 'failed',
        startedAt: 100,
        finishedAt: 450,
        message: 'invalid reference',
        params: { path: '/tmp/wt', branch: 'feature/x' },
      },
    ]);
  });

  it('a failed fetch lands as a failed fetch-remote-base step', () => {
    const lifecycle = buildCreationLifecycle(
      input,
      { status: 'failed', stage: 'fetch-base', message: 'could not resolve host' },
      [
        { stage: 'inspect', at: 100 },
        { stage: 'resolve-base', at: 120 },
        { stage: 'fetch-base', at: 130 },
      ],
      200
    );
    expect(lifecycle.steps).toEqual([
      {
        id: 'fetch-remote-base',
        status: 'failed',
        startedAt: 120,
        finishedAt: 200,
        message: 'could not resolve host',
        params: { base: 'origin/main' },
      },
    ]);
  });
});

describe('withLifecycleStep', () => {
  it('inserts new steps in canonical order and replaces existing ones in place', () => {
    const base = buildCreationLifecycle(
      { ...input, pushBranch: false },
      { status: 'succeeded', finalPath: '/tmp/wt', createdWorktree: true, createdBranch: true },
      [{ stage: 'inspect', at: 100 }],
      200
    );
    const withRun = withLifecycleStep(base, {
      id: 'run',
      status: 'running',
      startedAt: 300,
      finishedAt: null,
      params: {},
    });
    expect(withRun.steps.map((step) => step.id)).toEqual([
      'create-worktree',
      'copy-artifacts',
      'fetch-refs',
      'run',
    ]);
    const replaced = withLifecycleStep(withRun, {
      id: 'copy-artifacts',
      status: 'succeeded',
      startedAt: 210,
      finishedAt: 250,
      params: { fileCount: 3 },
    });
    expect(replaced.steps.map((step) => step.id)).toEqual(withRun.steps.map((step) => step.id));
    expect(replaced.steps[1]).toMatchObject({ status: 'succeeded', params: { fileCount: 3 } });
  });
});

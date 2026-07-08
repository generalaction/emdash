import { describe, expect, it } from 'vitest';
import type { BootstrapContext, BootstrapPlan, BootstrapProgress } from '../api/schemas';
import { step } from '../steps/catalog';
import { stepErr, stepOk, type StepOutcome } from '../steps/implement';
import type { BootstrapStepRegistry } from '../steps/registry';
import { bootstrapStepRegistry } from '../steps/registry';
import { RepoLock } from './repo-lock';
import { runBootstrapPlan } from './runner';

const context: BootstrapContext = {
  repoPath: '/repo',
  worktreePoolPath: '/worktrees',
  baseRemote: 'origin',
  pushRemote: 'origin',
  preservePatterns: [],
};

describe('runBootstrapPlan', () => {
  it('streams status transitions and returns the resolved worktree path', async () => {
    const progress: BootstrapProgress[] = [];
    const result = await runBootstrapPlan(plan(), context, {
      registry: registry({
        'add-worktree': async () => stepOk({ facts: { path: '/worktrees/demo' } }),
      }),
      lock: new RepoLock(),
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.path).toBe('/worktrees/demo');
    expect(result.data.warnings).toEqual([]);
    expect(result.data.report).toEqual([
      {
        stepId: 'add-worktree:1',
        kind: 'add-worktree',
        args: { branchName: 'demo' },
        facts: { path: '/worktrees/demo' },
      },
      {
        stepId: 'copy-preserved-files:1',
        kind: 'copy-preserved-files',
        args: {},
        facts: {},
      },
    ]);
    expect(progress.at(0)?.steps.map((step) => step.status)).toEqual(['pending', 'pending']);
    expect(progress.some((entry) => entry.steps[0].status === 'running')).toBe(true);
    expect(progress.at(-1)?.steps.map((step) => step.status)).toEqual(['done', 'done']);
  });

  it('marks the failing step and skips pending steps', async () => {
    const progress: BootstrapProgress[] = [];
    const result = await runBootstrapPlan(plan(), context, {
      registry: registry({
        'add-worktree': async () =>
          stepErr('permanent', { type: 'worktree-failed', message: 'boom' }),
      }),
      lock: new RepoLock(),
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        stepId: 'add-worktree:1',
        stepKind: 'add-worktree',
        type: 'worktree-failed',
      });
    }
    expect(progress.at(-1)?.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
  });

  it('downgrades non-fatal failures to warnings', async () => {
    const result = await runBootstrapPlan(pushPlan(), context, {
      registry: registry({
        'push-branch': async () => stepErr('permanent', { type: 'push-failed', message: 'nope' }),
      }),
      lock: new RepoLock(),
    });

    expect(result).toEqual({
      success: true,
      data: {
        path: '',
        warnings: [{ type: 'push-failed', message: 'nope' }],
        report: [],
      },
    });
  });

  it('retries transient failures and surfaces attempts', async () => {
    let attempts = 0;
    const progress: BootstrapProgress[] = [];
    const result = await runBootstrapPlan(fetchPlan(), context, {
      registry: registry({
        'git-fetch': async () => {
          attempts++;
          return attempts < 3
            ? stepErr('transient', { type: 'fetch-failed', message: 'network' })
            : stepOk();
        },
      }),
      lock: new RepoLock(),
      retryDelaysMs: [0, 0],
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
    expect(
      progress
        .filter((entry) => entry.steps[0].status === 'running')
        .map((entry) => entry.steps[0].attempt)
    ).toEqual([1, 2, 3]);
  });

  it('cancels before starting a step', async () => {
    const abort = new AbortController();
    abort.abort();

    const progress: BootstrapProgress[] = [];
    const result = await runBootstrapPlan(plan(), context, {
      registry: registry(),
      lock: new RepoLock(),
      signal: abort.signal,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'cancelled', message: 'Workspace bootstrap was cancelled' },
    });
    expect(progress.at(-1)?.steps.map((step) => step.status)).toEqual(['skipped', 'skipped']);
  });

  it('fails if an add-worktree step never resolves a path', async () => {
    const result = await runBootstrapPlan(plan(), context, {
      registry: registry({
        'add-worktree': async () => stepOk(),
      }),
      lock: new RepoLock(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        stepId: 'add-worktree:1',
        stepKind: 'add-worktree',
        type: 'worktree-failed',
      });
    }
  });
});

function plan(): BootstrapPlan {
  return {
    steps: [
      {
        id: 'add-worktree:1',
        label: 'Create worktree',
        step: step('add-worktree', { branchName: 'demo' }),
      },
      {
        id: 'copy-preserved-files:1',
        label: 'Copy preserved files',
        step: step('copy-preserved-files', {}),
      },
    ],
  };
}

function fetchPlan(): BootstrapPlan {
  return {
    steps: [
      {
        id: 'git-fetch:1',
        label: 'Fetch origin',
        step: step('git-fetch', { remote: 'origin' }),
      },
    ],
  };
}

function pushPlan(): BootstrapPlan {
  return {
    steps: [
      {
        id: 'push-branch:1',
        label: 'Push branch demo',
        step: step('push-branch', { branchName: 'demo', remote: 'origin' }),
      },
    ],
  };
}

function registry(
  overrides: Partial<
    Record<keyof BootstrapStepRegistry, () => Promise<StepOutcome> | StepOutcome>
  > = {}
) {
  return Object.fromEntries(
    Object.entries(bootstrapStepRegistry).map(([kind, implementation]) => [
      kind,
      {
        descriptor: implementation.descriptor,
        execute: overrides[kind as keyof BootstrapStepRegistry] ?? (async () => stepOk()),
      },
    ])
  ) as unknown as BootstrapStepRegistry;
}

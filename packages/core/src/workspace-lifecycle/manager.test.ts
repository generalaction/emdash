import { err } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { BootstrapPlan } from './api/schemas';
import { WorkspaceLifecycleManager } from './manager';
import { compileTeardownFromProbe } from './plan/teardown';
import { probeWorkspace } from './probe';
import { step } from './steps/catalog';
import { createTestRepository } from './test-utils';

describe('WorkspaceLifecycleManager', () => {
  it('rejects illegal transitions against probed state', async () => {
    const repo = await createTestRepository();
    try {
      const manager = new WorkspaceLifecycleManager();
      const result = await manager.runPhase(
        {
          ref: ref(repo, 'setup-first'),
          phase: 'setup',
          plan: { steps: [] },
          context: context(repo),
        },
        jobCtx('setup-first')
      );

      expect(result).toMatchObject({
        success: false,
        error: { type: 'illegal-transition' },
      });
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });

  it('provisions a worktree and publishes derived lifecycle state', async () => {
    const repo = await createTestRepository();
    try {
      const manager = new WorkspaceLifecycleManager();
      const result = await manager.runPhase(
        {
          ref: ref(repo, 'feature/provision'),
          phase: 'provision',
          plan: provisionPlan('feature/provision'),
          context: context(repo),
        },
        jobCtx('provision')
      );

      expect(result.success).toBe(true);
      const state = manager.host
        .get({ workspaceId: 'workspace-1' })
        ?.states.lifecycle.snapshot().data;
      expect(state).toMatchObject({
        phase: 'provisioned',
        branchName: 'feature/provision',
        branchCreatedByEmdash: true,
      });
      expect(state?.path).toContain('feature-provision');
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });

  it('vetoes teardown unless force is set', async () => {
    const repo = await createTestRepository();
    try {
      const beforeTeardown = vi.fn(async () =>
        err({ type: 'workspace-busy' as const, holders: ['pty'] })
      );
      const manager = new WorkspaceLifecycleManager({ hooks: { beforeTeardown } });
      const branchName = 'feature/teardown';
      const provision = await manager.runPhase(
        {
          ref: ref(repo, branchName),
          phase: 'provision',
          plan: provisionPlan(branchName),
          context: context(repo),
        },
        jobCtx('provision')
      );
      expect(provision.success).toBe(true);

      const observed = await probeWorkspace(ref(repo, branchName));
      const teardownPlan = compileTeardownFromProbe(observed, branchName);
      const blocked = await manager.runPhase(
        {
          ref: ref(repo, branchName),
          phase: 'teardown',
          plan: teardownPlan,
          context: context(repo),
        },
        jobCtx('teardown-blocked')
      );
      expect(blocked).toMatchObject({
        success: false,
        error: { type: 'workspace-busy', resolutions: ['force'] },
      });

      const forced = await manager.runPhase(
        {
          ref: ref(repo, branchName),
          phase: 'teardown',
          plan: teardownPlan,
          context: context(repo),
          force: true,
        },
        jobCtx('teardown-forced')
      );
      expect(forced.success).toBe(true);
      expect(beforeTeardown).toHaveBeenCalledTimes(1);
      expect(
        manager.host.get({ workspaceId: 'workspace-1' })?.states.lifecycle.snapshot().data.phase
      ).toBe('unprovisioned');
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });

  it('settles failed phases by probing reality and preserving lastError', async () => {
    const repo = await createTestRepository();
    try {
      const manager = new WorkspaceLifecycleManager();
      const branchName = 'feature/fail';
      const result = await manager.runPhase(
        {
          ref: ref(repo, branchName),
          phase: 'provision',
          plan: {
            steps: [
              {
                id: 'create-local-branch:1',
                label: 'Create branch',
                step: step('create-local-branch', { branchName, fromRef: 'main' }),
              },
              {
                id: 'run-script:1',
                label: 'Fail',
                step: step('run-script', { id: 'fail', command: 'exit 1', cwd: 'repo' }),
              },
            ],
          },
          context: context(repo),
        },
        jobCtx('fail')
      );

      expect(result.success).toBe(false);
      const state = manager.host
        .get({ workspaceId: 'workspace-1' })
        ?.states.lifecycle.snapshot().data;
      expect(state).toMatchObject({
        phase: 'unprovisioned',
        branchCreatedByEmdash: true,
        lastError: { type: 'script-failed' },
      });
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });
});

function ref(repo: { repoPath: string }, branchName: string) {
  return {
    workspaceId: 'workspace-1',
    repoPath: repo.repoPath,
    branchName,
  };
}

function context(repo: { repoPath: string; worktreePoolPath: string }) {
  return {
    repoPath: repo.repoPath,
    worktreePoolPath: repo.worktreePoolPath,
    baseRemote: 'origin',
    pushRemote: 'origin',
    preservePatterns: [],
  };
}

function provisionPlan(branchName: string): BootstrapPlan {
  return {
    steps: [
      {
        id: 'create-local-branch:1',
        label: 'Create branch',
        step: step('create-local-branch', { branchName, fromRef: 'main' }),
      },
      {
        id: 'add-worktree:1',
        label: 'Create worktree',
        step: step('add-worktree', { branchName }),
      },
    ],
  };
}

function jobCtx(jobId: string) {
  return {
    jobId,
    signal: new AbortController().signal,
    progress: vi.fn(),
  };
}

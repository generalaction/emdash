import path from 'node:path';
import { err } from '@emdash/shared';
import { step } from '@runtimes/workspace/api/provisioning/catalog';
import type { BootstrapPlan } from '@runtimes/workspace/api/provisioning/schemas';
import { compileTeardownFromProbe } from '@runtimes/workspace/api/provisioning/teardown';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceLifecycleManager } from './manager';
import { probeWorkspace } from './probe';
import { createTestRepository } from './testing/repository';

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
          plan: provisionPlan('feature/provision', ref(repo, 'feature/provision').path),
          context: context(repo),
        },
        jobCtx('provision')
      );

      expect(result.success).toBe(true);
      const refreshed = await manager.refresh(ref(repo, 'feature/provision'));
      expect(refreshed.success).toBe(true);
      if (!refreshed.success) throw new Error('expected refresh success');
      const state = refreshed.data;
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
          plan: provisionPlan(branchName, ref(repo, branchName).path),
          context: context(repo),
        },
        jobCtx('provision')
      );
      expect(provision.success).toBe(true);

      const observed = await probeWorkspace(ref(repo, branchName));
      const teardownPlan = compileTeardownFromProbe(observed, ref(repo, branchName));
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
      const refreshed = await manager.refresh(ref(repo, branchName));
      expect(refreshed.success).toBe(true);
      if (!refreshed.success) throw new Error('expected refresh success');
      expect(refreshed.data.phase).toBe('unprovisioned');
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
      const refreshed = await manager.refresh(ref(repo, branchName));
      expect(refreshed.success).toBe(true);
      if (!refreshed.success) throw new Error('expected refresh success');
      const state = refreshed.data;
      expect(state).toMatchObject({
        phase: 'unprovisioned',
        branchCreatedByEmdash: true,
      });
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });
});

function ref(repo: { repoPath: string }, branchName: string) {
  return {
    kind: 'worktree' as const,
    repoPath: repo.repoPath,
    path: path.join(
      path.dirname(repo.repoPath),
      'worktrees',
      branchName.replace(/[^a-zA-Z0-9._-]/g, '-')
    ),
    branchName,
  };
}

function context(repo: { repoPath: string }) {
  return {
    repoPath: repo.repoPath,
    preservePatterns: [],
    worktreePoolPath: path.join(path.dirname(repo.repoPath), 'worktrees'),
  };
}

function provisionPlan(branchName: string, worktreePath: string): BootstrapPlan {
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
        step: step('add-worktree', { branchName, path: worktreePath }),
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

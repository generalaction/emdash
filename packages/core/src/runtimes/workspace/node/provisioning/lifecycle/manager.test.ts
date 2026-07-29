import path from 'node:path';
import { step } from '@runtimes/workspace/api/provisioning/catalog';
import type { BootstrapPlan } from '@runtimes/workspace/api/provisioning/schemas';
import { compileTeardownFromProbe } from '@runtimes/workspace/api/provisioning/teardown';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceLifecycleManager } from './manager';
import { probeWorkspace } from './probe';
import { createTestRepository } from './testing/repository';

describe('WorkspaceLifecycleManager', () => {
  it('runs provisioning plans and leaves lifecycle state to probes and the machine', async () => {
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
      const observed = await probeWorkspace(ref(repo, 'feature/provision'));
      expect(observed).toMatchObject({
        branchName: 'feature/provision',
        branchCreatedByEmdash: true,
        directoryExists: true,
      });
      expect(observed.path).toContain('feature-provision');
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });

  it('runs teardown plans; busy checks are owned by WorkspaceMachine', async () => {
    const repo = await createTestRepository();
    try {
      const manager = new WorkspaceLifecycleManager();
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
      const teardown = await manager.runPhase(
        {
          ref: ref(repo, branchName),
          phase: 'teardown',
          plan: teardownPlan,
          context: context(repo),
          force: true,
        },
        jobCtx('teardown')
      );
      expect(teardown.success).toBe(true);
      const after = await probeWorkspace(ref(repo, branchName));
      expect(after.directoryExists).toBe(false);
      manager.dispose();
    } finally {
      await repo.cleanup();
    }
  });

  it('returns plan failures without publishing competing phase state', async () => {
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
      const observed = await probeWorkspace(ref(repo, branchName));
      expect(observed).toMatchObject({
        directoryExists: false,
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

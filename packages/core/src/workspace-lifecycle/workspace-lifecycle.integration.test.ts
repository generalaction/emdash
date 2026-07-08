import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BootstrapContext } from './api/schemas';
import { compileBootstrapPlan } from './plan/planner';
import { compileTeardownFromProbe } from './plan/teardown';
import { probeWorkspace } from './probe';
import { runBootstrapPlan } from './runner/runner';
import { step } from './steps/catalog';
import { createTestRepository, execGit } from './test-utils';

describe('workspace bootstrap runtime integration', () => {
  it('creates a branch worktree and copies preserved untracked files', async () => {
    const repo = await createTestRepository();
    try {
      await writeFile(path.join(repo.repoPath, '.env.local'), 'TOKEN=test\n');
      const context: BootstrapContext = {
        repoPath: repo.repoPath,
        worktreePoolPath: repo.worktreePoolPath,
        baseRemote: 'origin',
        pushRemote: 'origin',
        preservePatterns: ['.env.local'],
      };
      const plan = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/demo',
          fromBranch: { type: 'local', branch: 'main' },
        },
        context
      );

      const result = await runBootstrapPlan(plan, context);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      expect(result.data.path).toBe(path.join(repo.worktreePoolPath, 'task-demo'));
      expect(result.data.report.map((entry) => entry.kind)).toEqual([
        'create-local-branch',
        'set-branch-base',
        'add-worktree',
        'copy-preserved-files',
      ]);
      const head = await execGit(result.data.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
      expect(head.stdout.trim()).toBe('task/demo');
      await expect(readFile(path.join(result.data.path, '.env.local'), 'utf8')).resolves.toBe(
        'TOKEN=test\n'
      );
    } finally {
      await repo.cleanup();
    }
  });

  it('reports a diverged branch conflict and succeeds with reset resolution', async () => {
    const repo = await createTestRepository();
    try {
      await execGit(repo.repoPath, ['branch', 'task/conflict', 'main']);
      await writeFile(path.join(repo.repoPath, 'next.txt'), 'next\n');
      await execGit(repo.repoPath, ['add', 'next.txt']);
      await execGit(repo.repoPath, ['commit', '-m', 'advance main']);

      const context = contextFor(repo);
      const plan = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/conflict',
          fromBranch: { type: 'local', branch: 'main' },
        },
        context
      );

      const conflict = await runBootstrapPlan(plan, context);

      expect(conflict.success).toBe(false);
      if (conflict.success) throw new Error('Expected branch conflict');
      expect(conflict.error).toMatchObject({
        type: 'branch-exists-diverged',
        resolutions: ['use-existing', 'recreate', 'rename'],
      });

      const resetPlan = {
        steps: plan.steps.map((entry) =>
          entry.step.kind === 'create-local-branch'
            ? {
                ...entry,
                step: step('create-local-branch', {
                  branchName: 'task/conflict',
                  fromRef: 'main',
                  noTrack: true,
                  reset: true,
                }),
              }
            : entry
        ),
      };
      const reset = await runBootstrapPlan(resetPlan, context);

      expect(reset.success).toBe(true);
      if (!reset.success) throw new Error(reset.error.message);
      const head = await execGit(repo.repoPath, ['rev-parse', 'task/conflict']);
      const main = await execGit(repo.repoPath, ['rev-parse', 'main']);
      expect(head.stdout.trim()).toBe(main.stdout.trim());
    } finally {
      await repo.cleanup();
    }
  });

  it('compiles and runs a teardown plan from probed repo state', async () => {
    const repo = await createTestRepository();
    try {
      const context = contextFor(repo);
      const plan = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/teardown',
          fromBranch: { type: 'local', branch: 'main' },
        },
        context
      );
      const result = await runBootstrapPlan(plan, context);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);

      const observed = await probeWorkspace({
        workspaceId: 'workspace-1',
        repoPath: repo.repoPath,
        branchName: 'task/teardown',
      });
      const teardownPlan = compileTeardownFromProbe(observed, 'task/teardown');
      expect(teardownPlan.steps.map((entry) => entry.step.kind)).toEqual([
        'remove-worktree',
        'delete-branch',
      ]);

      const teardown = await runBootstrapPlan(teardownPlan, context);
      expect(teardown.success).toBe(true);
      await expect(stat(result.data.path)).rejects.toThrow();
      await expect(
        execGit(repo.repoPath, ['rev-parse', '--verify', 'refs/heads/task/teardown'])
      ).rejects.toThrow();
    } finally {
      await repo.cleanup();
    }
  });

  it('serializes concurrent bootstraps against one repo', async () => {
    const repo = await createTestRepository();
    try {
      const context = contextFor(repo);
      const first = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/one',
          fromBranch: { type: 'local', branch: 'main' },
        },
        context
      );
      const second = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/two',
          fromBranch: { type: 'local', branch: 'main' },
        },
        context
      );

      const [firstResult, secondResult] = await Promise.all([
        runBootstrapPlan(first, context),
        runBootstrapPlan(second, context),
      ]);

      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(true);
      await expect(stat(path.join(repo.worktreePoolPath, 'task-one'))).resolves.toBeDefined();
      await expect(stat(path.join(repo.worktreePoolPath, 'task-two'))).resolves.toBeDefined();
    } finally {
      await repo.cleanup();
    }
  });
});

function contextFor(repo: { repoPath: string; worktreePoolPath: string }): BootstrapContext {
  return {
    repoPath: repo.repoPath,
    worktreePoolPath: repo.worktreePoolPath,
    baseRemote: 'origin',
    pushRemote: 'origin',
    preservePatterns: [],
  };
}

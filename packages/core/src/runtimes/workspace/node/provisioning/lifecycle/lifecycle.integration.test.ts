import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { step } from '@runtimes/workspace/api/provisioning/catalog';
import { compileBootstrapPlan } from '@runtimes/workspace/api/provisioning/planner';
import type { BootstrapContext } from '@runtimes/workspace/api/provisioning/schemas';
import { compileTeardownFromProbe } from '@runtimes/workspace/api/provisioning/teardown';
import { runBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/runner/runner';
import { describe, expect, it } from 'vitest';
import { probeWorkspace } from './probe';
import { createTestRepository, execGit } from './testing/repository';

describe('workspace bootstrap runtime integration', () => {
  it('creates a branch worktree and copies preserved untracked files', async () => {
    const repo = await createTestRepository();
    try {
      await writeFile(path.join(repo.repoPath, '.env.local'), 'TOKEN=test\n');
      const context: BootstrapContext = {
        repoPath: repo.repoPath,
        preservePatterns: ['.env.local'],
      };
      const compiled = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/demo',
          fromBranch: { type: 'local', branch: 'main' },
        },
        optionsFor(repo)
      );

      const result = await runBootstrapPlan(compiled.plan, context);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      expect(result.data.path).toBe(compiled.workspacePath);
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
      const compiled = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/conflict',
          fromBranch: { type: 'local', branch: 'main' },
        },
        optionsFor(repo)
      );

      const conflict = await runBootstrapPlan(compiled.plan, context);

      expect(conflict.success).toBe(false);
      if (conflict.success) throw new Error('Expected branch conflict');
      expect(conflict.error).toMatchObject({
        type: 'branch-exists-diverged',
        resolutions: ['use-existing', 'recreate', 'rename'],
      });

      const resetPlan = {
        steps: compiled.plan.steps.map((entry) =>
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
      const compiled = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/teardown',
          fromBranch: { type: 'local', branch: 'main' },
        },
        optionsFor(repo)
      );
      const result = await runBootstrapPlan(compiled.plan, context);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);

      const observed = await probeWorkspace({
        kind: 'worktree',
        repoPath: repo.repoPath,
        path: compiled.workspacePath,
        branchName: 'task/teardown',
      });
      const teardownPlan = compileTeardownFromProbe(observed, {
        kind: 'worktree',
        repoPath: repo.repoPath,
        path: compiled.workspacePath,
        branchName: 'task/teardown',
      });
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

  it('reports an explicit-path worktree conflict when a branch is checked out elsewhere', async () => {
    const repo = await createTestRepository();
    try {
      const branchName = 'task/elsewhere';
      const firstPath = path.join(repo.worktreePoolPath, 'first');
      const secondPath = path.join(repo.worktreePoolPath, 'second');
      await execGit(repo.repoPath, ['branch', branchName, 'main']);
      await execGit(repo.repoPath, ['worktree', 'add', firstPath, branchName]);

      const conflict = await runBootstrapPlan(
        {
          steps: [
            {
              id: 'add-worktree:1',
              label: 'Create worktree',
              step: step('add-worktree', { branchName, path: secondPath }),
            },
          ],
        },
        contextFor(repo)
      );

      expect(conflict).toMatchObject({
        success: false,
        error: {
          type: 'branch-checked-out-elsewhere',
          resolutions: ['use-existing', 'remove-existing'],
        },
      });
    } finally {
      await repo.cleanup();
    }
  });

  it('clones a repository and streams git output', async () => {
    const source = await createTestRepository();
    const cloneRoot = path.join(source.root, 'clones');
    const clonePath = path.join(cloneRoot, 'repo-clone');
    try {
      const output: string[] = [];
      const progress: string[] = [];
      const result = await runBootstrapPlan(
        {
          steps: [
            {
              id: 'git-clone:1',
              label: 'Clone repo',
              step: step('git-clone', { url: source.repoPath, path: clonePath }),
            },
          ],
        },
        { repoPath: clonePath, preservePatterns: [] },
        {
          onStepOutput: (_stepId, chunk) => output.push(chunk),
          onProgress: (entry) => {
            const message = entry.steps[0].progress?.message;
            if (message) progress.push(message);
          },
        }
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      expect(result.data.path).toBe(clonePath);
      expect(output.join('')).toContain('Cloning into');
      expect(progress.length).toBeGreaterThan(0);
      await expect(stat(path.join(clonePath, '.git'))).resolves.toBeDefined();
    } finally {
      await source.cleanup();
    }
  });

  it('tears down a directory workspace through remove-directory', async () => {
    const repo = await createTestRepository();
    try {
      const workspacePath = path.join(repo.root, 'plain-workspace');
      const create = await runBootstrapPlan(
        {
          steps: [
            {
              id: 'create-directory:1',
              label: 'Create directory',
              step: step('create-directory', { path: workspacePath }),
            },
          ],
        },
        { repoPath: workspacePath, preservePatterns: [] }
      );
      expect(create.success).toBe(true);

      const teardownPlan = compileTeardownFromProbe(
        await probeWorkspace({ kind: 'directory', path: workspacePath }),
        { kind: 'directory', path: workspacePath }
      );
      expect(teardownPlan.steps.map((entry) => entry.step.kind)).toEqual(['remove-directory']);

      const teardown = await runBootstrapPlan(teardownPlan, {
        repoPath: workspacePath,
        preservePatterns: [],
      });
      expect(teardown.success).toBe(true);
      await expect(stat(workspacePath)).rejects.toThrow();
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
        optionsFor(repo)
      );
      const second = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/two',
          fromBranch: { type: 'local', branch: 'main' },
        },
        optionsFor(repo)
      );

      const [firstResult, secondResult] = await Promise.all([
        runBootstrapPlan(first.plan, context),
        runBootstrapPlan(second.plan, context),
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
    preservePatterns: [],
  };
}

function optionsFor(repo: { worktreePoolPath: string }) {
  return {
    worktreePoolPath: repo.worktreePoolPath,
    baseRemote: 'origin',
  };
}

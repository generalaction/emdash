import path from 'node:path';
import { step } from '@runtimes/workspace/api/provisioning/catalog';
import { runBootstrapPlan } from '@runtimes/workspace/node/provisioning/lifecycle/runner/runner';
import { describe, expect, it } from 'vitest';
import { derivePhase, listRepoWorkspaces, probeWorkspace } from './probe';
import { createTestRepository, execGit } from './testing/repository';

describe('probeWorkspace', () => {
  it('derives lifecycle state from git worktrees, branch markers, and setup stamps', async () => {
    const repo = await createTestRepository();
    try {
      const ref = {
        kind: 'worktree' as const,
        repoPath: repo.repoPath,
        path: path.join(repo.worktreePoolPath, 'feature-demo'),
        branchName: 'feature/demo',
        setupConfigHash: 'hash-a',
      };

      const initial = await probeWorkspace(ref);
      expect(initial).toMatchObject({
        branchExists: false,
        branchCreatedByEmdash: false,
        setup: 'setup-needed',
      });
      expect(derivePhase(initial, undefined)).toBe('unprovisioned');

      const result = await runBootstrapPlan(
        {
          steps: [
            {
              id: 'create-local-branch:1',
              label: 'Create branch',
              step: step('create-local-branch', { branchName: ref.branchName, fromRef: 'main' }),
            },
            {
              id: 'add-worktree:1',
              label: 'Create worktree',
              step: step('add-worktree', { branchName: ref.branchName, path: ref.path }),
            },
            {
              id: 'write-setup-stamp:1',
              label: 'Write setup stamp',
              step: step('write-setup-stamp', { configHash: ref.setupConfigHash }),
            },
          ],
        },
        {
          repoPath: repo.repoPath,
          preservePatterns: [],
        }
      );
      expect(result.success).toBe(true);

      const ready = await probeWorkspace(ref);
      expect(ready.branchExists).toBe(true);
      expect(ready.branchCreatedByEmdash).toBe(true);
      expect(ready.git).toBe('worktree');
      expect(ready.worktree?.directoryExists).toBe(true);
      expect(ready.setup).toBe('ready');
      expect(derivePhase(ready, undefined)).toBe('ready');

      const list = await listRepoWorkspaces(repo.repoPath);
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            branchName: 'main',
            isMain: true,
          }),
          expect.objectContaining({
            branchName: ref.branchName,
            path: expect.stringContaining('/worktrees/feature-demo'),
            branchCreatedByEmdash: true,
          }),
        ])
      );

      await execGit(repo.repoPath, ['branch', 'user/worktree', 'main']);
      await execGit(repo.repoPath, [
        'worktree',
        'add',
        path.join(repo.worktreePoolPath, 'user-worktree'),
        'user/worktree',
      ]);
      const withUserWorktree = await listRepoWorkspaces(repo.repoPath);
      expect(withUserWorktree).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            branchName: 'user/worktree',
            branchCreatedByEmdash: false,
          }),
        ])
      );

      const stale = await probeWorkspace({ ...ref, setupConfigHash: 'hash-b' });
      expect(stale.setup).toBe('setup-stale');
      expect(derivePhase(stale, undefined)).toBe('provisioned');

      await execGit(repo.repoPath, ['worktree', 'remove', '--force', ref.path]);
      const removed = await probeWorkspace(ref);
      expect(derivePhase(removed, undefined)).toBe('unprovisioned');
    } finally {
      await repo.cleanup();
    }
  });

  it('derives non-git directory lifecycle from fallback setup stamps', async () => {
    const repo = await createTestRepository();
    try {
      const ref = {
        kind: 'directory' as const,
        path: path.join(repo.root, 'plain-workspace'),
        setupConfigHash: 'plain-hash',
      };
      const result = await runBootstrapPlan(
        {
          steps: [
            {
              id: 'create-directory:1',
              label: 'Create directory',
              step: step('create-directory', { path: ref.path }),
            },
            {
              id: 'write-setup-stamp:1',
              label: 'Write setup stamp',
              step: step('write-setup-stamp', { configHash: ref.setupConfigHash }),
            },
          ],
        },
        { repoPath: ref.path, preservePatterns: [] }
      );
      expect(result.success).toBe(true);

      const observed = await probeWorkspace(ref);
      expect(observed.git).toBe('none');
      expect(observed.setup).toBe('ready');
      expect(derivePhase(observed, undefined)).toBe('ready');
    } finally {
      await repo.cleanup();
    }
  });
});

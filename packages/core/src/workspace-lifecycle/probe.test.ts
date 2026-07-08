import { describe, expect, it } from 'vitest';
import { derivePhase, probeWorkspace } from './probe';
import { runBootstrapPlan } from './runner/runner';
import { step } from './steps/catalog';
import { createTestRepository, execGit } from './test-utils';

describe('probeWorkspace', () => {
  it('derives lifecycle state from git worktrees, branch markers, and setup stamps', async () => {
    const repo = await createTestRepository();
    try {
      const ref = {
        workspaceId: 'workspace-1',
        repoPath: repo.repoPath,
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
              step: step('add-worktree', { branchName: ref.branchName }),
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
          worktreePoolPath: repo.worktreePoolPath,
          baseRemote: 'origin',
          pushRemote: 'origin',
          preservePatterns: [],
        }
      );
      expect(result.success).toBe(true);

      const ready = await probeWorkspace(ref);
      expect(ready.branchExists).toBe(true);
      expect(ready.branchCreatedByEmdash).toBe(true);
      expect(ready.worktree?.directoryExists).toBe(true);
      expect(ready.setup).toBe('ready');
      expect(derivePhase(ready, undefined)).toBe('ready');

      const stale = await probeWorkspace({ ...ref, setupConfigHash: 'hash-b' });
      expect(stale.setup).toBe('setup-stale');
      expect(derivePhase(stale, undefined)).toBe('provisioned');

      await execGit(repo.repoPath, ['worktree', 'remove', '--force', ready.worktree!.path]);
      const removed = await probeWorkspace(ref);
      expect(derivePhase(removed, undefined)).toBe('unprovisioned');
    } finally {
      await repo.cleanup();
    }
  });
});

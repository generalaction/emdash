import { describe, expect, it, vi } from 'vitest';
import { execute } from './git-fetch';
import type { StepContext } from './step-context';

function makeCtx(exec: StepContext['ctx']['exec']): StepContext {
  return {
    ctx: { exec } as StepContext['ctx'],
    repoPath: '/repo',
    worktreePoolPath: '/repo/.emdash/worktrees',
    host: {} as StepContext['host'],
    projectSettings: {} as StepContext['projectSettings'],
    worktreeService: {} as StepContext['worktreeService'],
  };
}

describe('git-fetch setup step', () => {
  it('treats a checked-out destination branch as already available', async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce({
        stderr:
          "fatal: refusing to fetch into branch 'refs/heads/feature/pr' checked out at '/worktrees/feature-pr'",
      })
      .mockResolvedValueOnce({
        stdout: 'worktree /worktrees/feature-pr\nHEAD abc123\nbranch refs/heads/feature/pr\n',
        stderr: '',
      });

    const result = await execute(
      {
        remote: 'origin',
        refspec: 'refs/pull/123/head:refs/heads/feature/pr',
        force: true,
      },
      makeCtx(exec as StepContext['ctx']['exec'])
    );

    expect(result.success).toBe(true);
    expect(exec).toHaveBeenNthCalledWith(1, 'git', [
      'fetch',
      'origin',
      'refs/pull/123/head:refs/heads/feature/pr',
      '--force',
    ]);
    expect(exec).toHaveBeenNthCalledWith(2, 'git', ['worktree', 'list', '--porcelain']);
  });

  it('returns the fetch failure when the destination branch is not checked out', async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce({
        stderr:
          "fatal: refusing to fetch into branch 'refs/heads/feature/pr' checked out at '/worktrees/feature-pr'",
      })
      .mockResolvedValueOnce({
        stdout: 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n',
        stderr: '',
      });

    const result = await execute(
      {
        remote: 'origin',
        refspec: 'refs/pull/123/head:refs/heads/feature/pr',
        force: true,
      },
      makeCtx(exec as StepContext['ctx']['exec'])
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error.type).toBe('fetch-failed');
  });
});

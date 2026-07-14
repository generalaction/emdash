import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitCommitImpl } from './git-commit';

const git = vi.hoisted(() => ({ runGit: vi.fn() }));

vi.mock('@runtimes/workspace/node/provisioning/lifecycle/steps/run-git', () => ({
  gitErrorMessage: (error: { message: string }) => error.message,
  runGit: git.runGit,
}));

describe('gitCommitImpl', () => {
  beforeEach(() => {
    git.runGit.mockReset();
  });

  it('stages the selected paths and creates a commit', async () => {
    git.runGit.mockResolvedValue({ success: true, data: { stdout: '', stderr: '' } });

    const result = await gitCommitImpl.execute(
      { message: 'Initial commit', paths: ['README.md'] },
      { repoPath: '/repo', resolvedWorktreePath: '/workspace/repo', preservePatterns: [] }
    );

    expect(result.success).toBe(true);
    expect(git.runGit).toHaveBeenNthCalledWith(1, ['add', '--', 'README.md'], {
      cwd: '/workspace/repo',
      signal: undefined,
    });
    expect(git.runGit).toHaveBeenNthCalledWith(2, ['commit', '-m', 'Initial commit'], {
      cwd: '/workspace/repo',
      signal: undefined,
    });
  });

  it('returns a typed failure when staging fails', async () => {
    git.runGit.mockResolvedValueOnce({
      success: false,
      error: { type: 'git-error', message: 'fatal: pathspec failed', stderr: '', stdout: '' },
    });

    const result = await gitCommitImpl.execute(
      { message: 'Initial commit', paths: ['README.md'] },
      { repoPath: '/repo', preservePatterns: [] }
    );

    expect(result).toMatchObject({
      success: false,
      class: 'permanent',
      error: {
        type: 'git-stage-failed',
        message: 'fatal: pathspec failed',
      },
    });
    expect(git.runGit).toHaveBeenCalledTimes(1);
  });
});

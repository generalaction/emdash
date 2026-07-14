import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitFetchImpl } from './git-fetch';

const git = vi.hoisted(() => ({ runGitStreaming: vi.fn() }));

vi.mock('@runtimes/workspace/node/provisioning/lifecycle/steps/run-git-streaming', () => ({
  runGitStreaming: git.runGitStreaming,
}));

describe('gitFetchImpl', () => {
  beforeEach(() => {
    git.runGitStreaming.mockReset();
  });

  it('passes no-tags and partial clone filters before the remote', async () => {
    git.runGitStreaming.mockResolvedValue({
      success: true,
      data: { stdout: '', stderr: '' },
    });

    const result = await gitFetchImpl.execute(
      {
        remote: 'origin',
        refspec: '+refs/heads/main:refs/remotes/origin/main',
        noTags: true,
        filter: 'blob:none',
      },
      { repoPath: '/repo', preservePatterns: [] }
    );

    expect(result.success).toBe(true);
    expect(git.runGitStreaming).toHaveBeenCalledWith(
      [
        'fetch',
        '--progress',
        '--no-tags',
        '--filter=blob:none',
        'origin',
        '+refs/heads/main:refs/remotes/origin/main',
      ],
      expect.objectContaining({ cwd: '/repo' })
    );
  });

  it.each([
    'error: fetching ref refs/remotes/origin/main failed: incorrect old value provided',
    "cannot lock ref 'refs/remotes/origin/main': is at bbbb but expected aaaa",
  ])('surfaces stale ref updates as permanent typed failures: %s', async (message) => {
    git.runGitStreaming.mockResolvedValue({
      success: false,
      error: {
        type: 'git-error',
        message,
        stdout: '',
        stderr: message,
        code: 1,
      },
    });

    const result = await gitFetchImpl.execute(
      {
        remote: 'origin',
        refspec: '+refs/heads/main:refs/remotes/origin/main',
      },
      { repoPath: '/repo', preservePatterns: [] }
    );

    expect(result).toEqual({
      success: false,
      class: 'permanent',
      error: {
        type: 'fetch-failed',
        code: 'stale_ref_update',
        message,
      },
    });
    expect(git.runGitStreaming).toHaveBeenCalledTimes(1);
  });

  it('keeps unrelated lock-file failures generic', async () => {
    const message =
      "cannot lock ref 'refs/remotes/origin/main': Unable to create 'main.lock': File exists";
    git.runGitStreaming.mockResolvedValue({
      success: false,
      error: {
        type: 'git-error',
        message,
        stdout: '',
        stderr: message,
        code: 1,
      },
    });

    const result = await gitFetchImpl.execute(
      {
        remote: 'origin',
        refspec: '+refs/heads/main:refs/remotes/origin/main',
      },
      { repoPath: '/repo', preservePatterns: [] }
    );

    expect(result).toMatchObject({
      success: false,
      class: 'permanent',
      error: {
        type: 'fetch-failed',
        message,
      },
    });
    if (!result.success) expect(result.error).not.toHaveProperty('code');
  });
});

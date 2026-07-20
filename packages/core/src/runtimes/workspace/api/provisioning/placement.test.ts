import { describe, expect, it } from 'vitest';
import { defaultRepositoriesRoot, defaultWorktreesRoot, deriveWorktreePoolPath } from './placement';

describe('workspace placement', () => {
  it('derives default roots from a POSIX host home directory', () => {
    expect(defaultRepositoriesRoot('/home/jona')).toBe('/home/jona/emdash/repositories');
    expect(defaultWorktreesRoot('/home/jona')).toBe('/home/jona/emdash/worktrees');
  });

  it('derives default roots from a Windows host home directory', () => {
    expect(defaultRepositoriesRoot('C:\\Users\\jona')).toBe(
      'C:\\Users\\jona\\emdash\\repositories'
    );
    expect(defaultWorktreesRoot('C:\\Users\\jona')).toBe('C:\\Users\\jona\\emdash\\worktrees');
  });

  it('uses the repository basename and a stable path hash for a worktree pool', () => {
    expect(
      deriveWorktreePoolPath({
        worktreesRoot: '/home/jona/emdash/worktrees',
        repoPath: '/home/jona/emdash/repositories/emdash',
      })
    ).toBe('/home/jona/emdash/worktrees/emdash-ba5cbeaf');
  });

  it('keeps repositories with the same basename in different pools', () => {
    const first = deriveWorktreePoolPath({
      worktreesRoot: '/worktrees',
      repoPath: '/repos/one/api',
    });
    const second = deriveWorktreePoolPath({
      worktreesRoot: '/worktrees',
      repoPath: '/repos/two/api',
    });

    expect(first).toMatch(/^\/worktrees\/api-[a-f0-9]{8}$/u);
    expect(second).toMatch(/^\/worktrees\/api-[a-f0-9]{8}$/u);
    expect(first).not.toBe(second);
  });
});

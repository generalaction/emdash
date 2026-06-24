import type { LocalBranch } from '@emdash/core/git';
import { describe, expect, it, vi } from 'vitest';
import type { GitService } from '@main/core/git/legacy/git-service';
import { log } from '@main/lib/logger';
import { LegacySshGitRepository, LegacySshGitWorktree } from './ssh-git';

describe('LegacySshGitRepository', () => {
  it('treats unavailable SSH connections during background refs refresh as recoverable', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const firstRefs: LocalBranch[] = [{ type: 'local', branch: 'main', oid: 'abc123' }];
    const getBranches = vi
      .fn<() => Promise<LocalBranch[]>>()
      .mockResolvedValueOnce(firstRefs)
      .mockRejectedValueOnce(new Error('SSH connection is not available'));
    const git = {
      getBranches,
      getRemotes: vi.fn(async () => []),
      dispose: vi.fn(),
    } as unknown as GitService;
    const repository = new LegacySshGitRepository(git, '/repo/.git');

    try {
      await expect(repository.getRefs()).resolves.toEqual({ branches: firstRefs });
      const updates: unknown[] = [];
      const unsubscribe = repository.subscribe((update) => updates.push(update));

      await vi.advanceTimersByTimeAsync(15_000);

      expect(getBranches).toHaveBeenCalledTimes(2);
      expect(updates).toEqual([]);
      expect(warn).toHaveBeenCalledWith('LegacySshGitRepository: refs refresh failed', {
        error: expect.any(Error),
      });

      unsubscribe();
    } finally {
      repository.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('treats unavailable SSH connections during background status refresh as recoverable', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const getFullStatus = vi
      .fn<() => Promise<Awaited<ReturnType<GitService['getFullStatus']>>>>()
      .mockResolvedValueOnce({
        staged: [],
        unstaged: [],
        currentBranch: 'main',
        headKind: 'branch',
        shortHash: 'abc123',
        totalAdded: 0,
        totalDeleted: 0,
      })
      .mockRejectedValueOnce(new Error('SSH connection is not available'));
    const git = {
      getFullStatus,
      getHeadInfo: vi.fn(async () => ({ kind: 'branch', name: 'main', oid: 'abc123' })),
      getStatusFingerprint: vi
        .fn<() => Promise<{ hash: string }>>()
        .mockResolvedValueOnce({ hash: 'h1' })
        .mockResolvedValueOnce({ hash: 'h2' }),
      dispose: vi.fn(),
    } as unknown as GitService;
    const worktree = new LegacySshGitWorktree(git, '/repo/worktree', {} as LegacySshGitRepository);

    try {
      await expect(worktree.getStatus()).resolves.toEqual({
        kind: 'ok',
        staged: [],
        unstaged: [],
        stagedAdded: 0,
        stagedDeleted: 0,
      });
      const updates: unknown[] = [];
      const unsubscribe = worktree.subscribe((update) => updates.push(update));

      await vi.advanceTimersByTimeAsync(20_000);

      expect(getFullStatus).toHaveBeenCalledTimes(2);
      expect(updates).toEqual([]);
      expect(warn).toHaveBeenCalledWith('LegacySshGitWorktree: status refresh failed', {
        error: expect.any(Error),
      });

      unsubscribe();
    } finally {
      worktree.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('treats unavailable SSH connections during background head refresh as recoverable', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const getHeadInfo = vi
      .fn<() => Promise<Awaited<ReturnType<GitService['getHeadInfo']>>>>()
      .mockResolvedValueOnce({ kind: 'branch', name: 'main', oid: 'abc123' })
      .mockRejectedValueOnce(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    const git = {
      getFullStatus: vi.fn(async () => ({
        staged: [],
        unstaged: [],
        currentBranch: 'main',
        headKind: 'branch',
        shortHash: 'abc123',
        totalAdded: 0,
        totalDeleted: 0,
      })),
      getHeadInfo,
      getStatusFingerprint: vi.fn(async () => ({ hash: 'h1' })),
      dispose: vi.fn(),
    } as unknown as GitService;
    const worktree = new LegacySshGitWorktree(git, '/repo/worktree', {} as LegacySshGitRepository);

    try {
      await expect(worktree.getHead()).resolves.toEqual({
        kind: 'branch',
        name: 'main',
        oid: 'abc123',
      });
      const updates: unknown[] = [];
      const unsubscribe = worktree.subscribe((update) => updates.push(update));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(getHeadInfo).toHaveBeenCalledTimes(2);
      expect(updates).toEqual([]);
      expect(warn).toHaveBeenCalledWith('LegacySshGitWorktree: head refresh failed', {
        error: expect.any(Error),
      });

      unsubscribe();
    } finally {
      worktree.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

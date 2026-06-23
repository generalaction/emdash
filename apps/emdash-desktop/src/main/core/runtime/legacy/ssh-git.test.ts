import type { LocalBranch } from '@emdash/core/git';
import { describe, expect, it, vi } from 'vitest';
import type { GitService } from '@main/core/git/legacy/git-service';
import { log } from '@main/lib/logger';
import { LegacySshGitRepository } from './ssh-git';

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
});

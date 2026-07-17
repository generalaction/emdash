import { describe, expect, it, vi } from 'vitest';
import { GitRepositoryFetchService } from './fetch-service';
import type { GitRepositoryService } from './service';

function makeGitRepository(
  overrides: Partial<Pick<GitRepositoryService, 'fetch' | 'getRemotes'>>
): GitRepositoryService {
  return overrides as unknown as GitRepositoryService;
}

describe('GitRepositoryFetchService', () => {
  it('attempts background fetches for SSH remotes using system git credentials', async () => {
    const fetch = vi.fn().mockResolvedValue({ success: true, data: { sequences: { refs: 1 } } });
    const getRemotes = vi
      .fn()
      .mockResolvedValue([{ name: 'origin', url: 'git@github.com:owner/repo.git' }]);
    const getRemote = vi.fn().mockResolvedValue('origin');

    const service = new GitRepositoryFetchService(
      makeGitRepository({ fetch, getRemotes }),
      getRemote
    );

    service.start();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('origin'));
    service.stop();
  });
});

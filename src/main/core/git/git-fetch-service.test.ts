import { describe, expect, it, vi } from 'vitest';
import { GitFetchService } from './git-fetch-service';
import type { GitService } from './impl/git-service';

function makeGit(overrides: Partial<Pick<GitService, 'fetch' | 'getRemotes'>>): GitService {
  return overrides as unknown as GitService;
}

describe('GitFetchService', () => {
  it('attempts background fetches for SSH remotes using system git credentials', async () => {
    const fetch = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const getRemotes = vi
      .fn()
      .mockResolvedValue([{ name: 'origin', url: 'git@github.com:owner/repo.git' }]);
    const getRemote = vi.fn().mockResolvedValue('origin');

    const service = new GitFetchService(makeGit({ fetch, getRemotes }), getRemote);

    service.start();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('origin'));
    service.stop();
  });
});

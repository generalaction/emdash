import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { ghCliGitHubEnterpriseAuthSource } from './ghes-auth-source';
import { GitHubApiAuthService } from './github-api-auth-service';
import { githubConnectionService } from './github-connection-service';

vi.mock('./github-connection-service', () => ({
  githubConnectionService: {
    getToken: vi.fn(),
  },
}));

vi.mock('./ghes-auth-source', () => ({
  ghCliGitHubEnterpriseAuthSource: {
    getToken: vi.fn(),
  },
}));

const mockGithubConnectionService = vi.mocked(githubConnectionService);
const mockGhesAuthSource = vi.mocked(ghCliGitHubEnterpriseAuthSource);

describe('GitHubApiAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the GitHub.com connection service for github.com hosts', async () => {
    mockGithubConnectionService.getToken.mockResolvedValue('github-token');

    await expect(new GitHubApiAuthService().getToken('www.github.com')).resolves.toEqual(
      ok('github-token')
    );
    expect(mockGithubConnectionService.getToken).toHaveBeenCalledTimes(1);
    expect(mockGhesAuthSource.getToken).not.toHaveBeenCalled();
  });

  it('uses the GHES auth source for enterprise hosts', async () => {
    mockGhesAuthSource.getToken.mockResolvedValue('ghes-token');

    await expect(new GitHubApiAuthService().getToken('GHE.EXAMPLE.COM')).resolves.toEqual(
      ok('ghes-token')
    );
    expect(mockGhesAuthSource.getToken).toHaveBeenCalledWith('ghe.example.com');
    expect(mockGithubConnectionService.getToken).not.toHaveBeenCalled();
  });

  it('returns a GHES login hint when the enterprise token is missing', async () => {
    mockGhesAuthSource.getToken.mockResolvedValue(null);

    await expect(new GitHubApiAuthService().getToken('ghe.example.com')).resolves.toEqual(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message:
          'GitHub Enterprise authentication required for ghe.example.com. Run: gh auth login --hostname ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });
});

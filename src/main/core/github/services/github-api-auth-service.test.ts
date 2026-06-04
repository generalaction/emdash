import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { ghCliGitHubEnterpriseAuthSource } from './ghes-auth-source';
import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubApiAuthService } from './github-api-auth-service';
import { githubConnectionService } from './github-connection-service';

vi.mock('./github-connection-service', () => ({
  githubConnectionService: {
    getToken: vi.fn(),
  },
}));

vi.mock('./github-account-registry-instance', () => ({
  githubAccountRegistry: {
    listAccounts: vi.fn(),
    resolveToken: vi.fn(),
  },
}));

vi.mock('./ghes-auth-source', () => ({
  ghCliGitHubEnterpriseAuthSource: {
    getToken: vi.fn(),
  },
}));

const mockGithubConnectionService = vi.mocked(githubConnectionService);
const mockGithubAccountRegistry = vi.mocked(githubAccountRegistry);
const mockGhesAuthSource = vi.mocked(ghCliGitHubEnterpriseAuthSource);

describe('GitHubApiAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the selected GitHub.com account token when an account id is provided', async () => {
    mockGithubAccountRegistry.listAccounts.mockResolvedValue([
      {
        id: 'github.com:42',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
        credentialSource: 'emdash_oauth',
        connectedAt: 1,
        updatedAt: 1,
      },
    ]);
    mockGithubAccountRegistry.resolveToken.mockResolvedValue('selected-account-token');

    await expect(
      new GitHubApiAuthService().getToken('github.com', { accountId: 'github.com:42' })
    ).resolves.toEqual(ok('selected-account-token'));
    expect(mockGithubAccountRegistry.resolveToken).toHaveBeenCalledWith('github.com:42');
    expect(mockGithubConnectionService.getToken).not.toHaveBeenCalled();
  });

  it('returns auth required when the selected GitHub.com account is missing', async () => {
    mockGithubAccountRegistry.listAccounts.mockResolvedValue([]);

    await expect(
      new GitHubApiAuthService().getToken('github.com', { accountId: 'github.com:42' })
    ).resolves.toEqual(
      err({
        type: 'auth_required',
        host: 'github.com',
        message: 'GitHub authentication required.',
      })
    );
    expect(mockGithubAccountRegistry.resolveToken).not.toHaveBeenCalled();
    expect(mockGithubConnectionService.getToken).not.toHaveBeenCalled();
  });

  it('returns auth required when the selected GitHub.com account token is missing', async () => {
    mockGithubAccountRegistry.listAccounts.mockResolvedValue([
      {
        id: 'github.com:42',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
        credentialSource: 'emdash_oauth',
        connectedAt: 1,
        updatedAt: 1,
      },
    ]);
    mockGithubAccountRegistry.resolveToken.mockResolvedValue(null);

    await expect(
      new GitHubApiAuthService().getToken('github.com', { accountId: 'github.com:42' })
    ).resolves.toEqual(
      err({
        type: 'auth_required',
        host: 'github.com',
        message: 'GitHub authentication required.',
      })
    );
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

  it('continues to use the GHES auth source when an account id is provided', async () => {
    mockGhesAuthSource.getToken.mockResolvedValue('ghes-token');

    await expect(
      new GitHubApiAuthService().getToken('GHE.EXAMPLE.COM', { accountId: 'github.com:42' })
    ).resolves.toEqual(ok('ghes-token'));
    expect(mockGhesAuthSource.getToken).toHaveBeenCalledWith('ghe.example.com');
    expect(mockGithubAccountRegistry.listAccounts).not.toHaveBeenCalled();
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

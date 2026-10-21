import type { RepositoryPluginProvider } from '@emdash/plugins/repository';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import { createGitHubRepositoryService } from './repo-service';

const readCredentials = vi.fn();
const listAccounts = vi.fn<() => Promise<GitHubAccountSummary[]>>();
const behavior = {
  listOwners: vi.fn(),
  createRepository: vi.fn(),
  deleteRepository: vi.fn(),
};
const plugin = { behavior: { repository: behavior } } as unknown as RepositoryPluginProvider;
const repoService = createGitHubRepositoryService({ readCredentials, listAccounts, plugin });

const credentials = { accessToken: 'token', apiBaseUrl: 'https://api.github.com' };

function account(
  accountId = 'github.com:42',
  host = 'github.com',
  isDefault = true
): GitHubAccountSummary {
  return {
    providerId: 'github',
    accountId,
    host,
    isDefault,
    displayName: 'Test',
    login: 'testuser',
    avatarUrl: '',
    credentialSource: 'emdash_oauth',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listAccounts.mockResolvedValue([
    account(),
    account('ghe.example.com:168', 'ghe.example.com', false),
  ]);
  readCredentials.mockResolvedValue(ok(credentials));
  behavior.listOwners.mockResolvedValue(ok([]));
  behavior.deleteRepository.mockResolvedValue(ok());
});

describe('GitHub repository service', () => {
  describe('account selection', () => {
    it('infers the GitHub.com account when the default belongs to Enterprise', async () => {
      listAccounts.mockResolvedValue([
        account('enterprise', 'ghe.example.com'),
        account('personal', 'github.com', false),
      ]);
      await repoService.getOwners();
      expect(readCredentials).toHaveBeenCalledWith('personal', 'github.com');
    });

    it('does not infer an arbitrary account when GitHub.com accounts are ambiguous', async () => {
      listAccounts.mockResolvedValue([
        account('enterprise', 'ghe.example.com'),
        account('first', 'github.com', false),
        account('second', 'github.com', false),
      ]);
      await expect(repoService.getOwners()).rejects.toMatchObject({
        authError: { type: 'auth_required' },
      });
      expect(readCredentials).not.toHaveBeenCalled();
    });

    it('requires a matching account for unselected GitHub.com operations', async () => {
      listAccounts.mockResolvedValue([account('enterprise', 'ghe.example.com')]);
      await expect(repoService.getOwners()).rejects.toMatchObject({
        authError: { type: 'auth_required', host: 'github.com' },
      });
      expect(readCredentials).not.toHaveBeenCalled();
    });

    it('gets an explicitly selected account host from metadata, including its port', async () => {
      listAccounts.mockResolvedValue([account('opaque-id', 'ghe.example.com:8443')]);
      await repoService.getOwners({ accountId: 'opaque-id' });
      expect(readCredentials).toHaveBeenCalledWith('opaque-id', 'ghe.example.com:8443');
    });

    it('does not fall back to the default for a missing explicit account', async () => {
      await expect(repoService.getOwners({ accountId: 'removed' })).rejects.toMatchObject({
        authError: { type: 'account_not_found', accountId: 'removed' },
      });
      expect(readCredentials).not.toHaveBeenCalled();
    });

    it('does not select another account if credential access fails after selection', async () => {
      readCredentials.mockResolvedValue(
        err({
          type: 'account_not_found',
          accountId: 'github.com:42',
          host: 'github.com',
          message: 'Removed',
        })
      );
      await expect(repoService.getOwners()).rejects.toMatchObject({
        authError: { type: 'account_not_found', accountId: 'github.com:42' },
      });
      expect(readCredentials).toHaveBeenCalledExactlyOnceWith('github.com:42', 'github.com');
      expect(behavior.listOwners).not.toHaveBeenCalled();
    });
  });

  it('passes the selected account’s credentials to the plugin', async () => {
    const owners = [{ login: 'testuser', type: 'User', avatarUrl: '' }];
    behavior.listOwners.mockResolvedValue(ok(owners));
    await expect(repoService.getOwners({ accountId: 'ghe.example.com:168' })).resolves.toEqual(
      owners
    );
    expect(readCredentials).toHaveBeenCalledWith('ghe.example.com:168', 'ghe.example.com');
    expect(behavior.listOwners).toHaveBeenCalledWith(expect.objectContaining({ credentials }));
  });

  it('maps create input and output between the service and plugin shapes', async () => {
    behavior.createRepository.mockResolvedValue(
      ok({
        repositoryUrl: 'https://github.com/acme/new',
        cloneUrl: 'https://github.com/acme/new.git',
        nameWithOwner: 'acme/new',
        defaultBranch: 'main',
      })
    );
    await expect(
      repoService.createRepository({ name: 'new', owner: 'acme', isPrivate: true })
    ).resolves.toEqual({
      url: 'https://github.com/acme/new',
      cloneUrl: 'https://github.com/acme/new.git',
      nameWithOwner: 'acme/new',
      defaultBranch: 'main',
    });
    expect(behavior.createRepository).toHaveBeenCalledWith(expect.anything(), {
      owner: 'acme',
      name: 'new',
      description: undefined,
      visibility: 'private',
      initializeWithReadme: undefined,
    });
  });

  it('forwards empty repository creation', async () => {
    behavior.createRepository.mockResolvedValue(
      ok({
        repositoryUrl: 'https://github.com/acme/new',
        cloneUrl: 'https://github.com/acme/new.git',
        nameWithOwner: 'acme/new',
        defaultBranch: 'main',
      })
    );
    await repoService.createRepository({
      name: 'new',
      owner: 'acme',
      isPrivate: true,
      initializeWithReadme: false,
    });
    expect(behavior.createRepository).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initializeWithReadme: false })
    );
  });

  it('deletes through the plugin', async () => {
    await repoService.deleteRepository('testuser', 'old-repo', { accountId: 'github.com:42' });
    expect(behavior.deleteRepository).toHaveBeenCalledWith(expect.anything(), {
      owner: 'testuser',
      name: 'old-repo',
    });
  });

  it('throws the plugin error message on failure', async () => {
    behavior.createRepository.mockResolvedValue(
      err({ type: 'auth_failed', message: 'GitHub authentication failed. Check your credentials.' })
    );
    await expect(
      repoService.createRepository({ name: 'new', owner: 'acme', isPrivate: false })
    ).rejects.toThrow('GitHub authentication failed. Check your credentials.');
  });
});

import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubTokenSource, GitHubUser } from '@shared/github';
import { GitHubAccountBackfillService } from './github-account-backfill';
import { GITHUB_PROVIDER_ID, upsertGitHubAccount } from './github-accounts';

class LegacyGitHubConnection {
  token: string | null = 'gho_monalisa';
  source: Exclude<GitHubTokenSource, null> | null = 'secure_storage';
  getStoredTokenRecord = vi.fn(async () =>
    this.token === null ? null : { token: this.token, source: this.source }
  );
  clearStoredToken = vi.fn(async () => {
    this.token = null;
  });
}

class GitHubIdentityClient {
  user: GitHubUser | null = {
    id: 42,
    login: 'monalisa',
    name: 'Mona Lisa',
    email: 'mona@example.com',
    avatar_url: 'https://avatars.githubusercontent.com/u/42',
  };

  getAuthenticatedUser = vi.fn(async () => this.user);
}

describe('GitHubAccountBackfillService', () => {
  let fixture: RegistryFixture;
  let legacyConnection: LegacyGitHubConnection;
  let identityClient: GitHubIdentityClient;
  let service: GitHubAccountBackfillService;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    legacyConnection = new LegacyGitHubConnection();
    identityClient = new GitHubIdentityClient();
    service = new GitHubAccountBackfillService(fixture.registry, legacyConnection, identityClient);
  });

  afterEach(() => {
    fixture?.close();
  });

  it('backfills the legacy GitHub token into linked accounts and sets the default', async () => {
    const account = await service.backfillLegacyToken();

    expect(account).toMatchObject({
      id: 'github.com:42',
      login: 'monalisa',
      credentialSource: 'secure_storage',
    });
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      'gho_monalisa'
    );
    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      'github.com:42'
    );
    expect(identityClient.getAuthenticatedUser).toHaveBeenCalledWith('gho_monalisa', 'github.com');
    expect(legacyConnection.clearStoredToken).toHaveBeenCalled();
  });

  it('does not replace an existing default account', async () => {
    const { account: existing } = await upsertGitHubAccount(fixture.registry, {
      accessToken: 'gho_octocat',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '84',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: '',
      },
    });

    await expect(service.backfillLegacyToken()).resolves.toMatchObject({ id: 'github.com:42' });

    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      existing.id
    );
  });

  it('does not backfill when the legacy token cannot identify a GitHub user', async () => {
    identityClient.user = null;

    await expect(service.backfillLegacyToken()).resolves.toBeNull();

    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBeNull();
    expect(legacyConnection.clearStoredToken).not.toHaveBeenCalled();
  });

  it('does not backfill when no stored legacy token exists', async () => {
    legacyConnection.token = null;

    await expect(service.backfillLegacyToken()).resolves.toBeNull();

    expect(identityClient.getAuthenticatedUser).not.toHaveBeenCalled();
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
  });

  it('uses CLI as the credential source when the legacy token came from GitHub CLI', async () => {
    legacyConnection.source = 'cli';

    await expect(service.backfillLegacyToken()).resolves.toMatchObject({
      id: 'github.com:42',
      credentialSource: 'cli',
    });
  });
});

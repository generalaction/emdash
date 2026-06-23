import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubTokenSource, GitHubUser } from '@shared/github';
import { GitHubAccountBackfillService } from './github-account-backfill';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';

class InMemoryMetadataStore implements GitHubAccountMetadataStore {
  accounts = null as Awaited<ReturnType<GitHubAccountMetadataStore['getAccounts']>>;
  defaultAccountId: string | null = null;
  removedCliAccounts = null as Awaited<
    ReturnType<GitHubAccountMetadataStore['getRemovedCliAccounts']>
  >;

  async getAccounts() {
    return this.accounts;
  }

  async setAccounts(accounts: NonNullable<typeof this.accounts>) {
    this.accounts = accounts;
  }

  async getDefaultAccountId() {
    return this.defaultAccountId;
  }

  async setDefaultAccountId(accountId: string | null) {
    this.defaultAccountId = accountId;
  }

  async getRemovedCliAccounts() {
    return this.removedCliAccounts;
  }

  async setRemovedCliAccounts(accounts: NonNullable<typeof this.removedCliAccounts>) {
    this.removedCliAccounts = accounts;
  }
}

class InMemorySecretStore implements GitHubAccountSecretStore {
  private readonly secrets = new Map<string, string>();

  async getSecret(key: string) {
    return this.secrets.get(key) ?? null;
  }

  async setSecret(key: string, value: string) {
    this.secrets.set(key, value);
  }

  async deleteSecret(key: string) {
    this.secrets.delete(key);
  }
}

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
  let registry: GitHubAccountRegistry;
  let legacyConnection: LegacyGitHubConnection;
  let identityClient: GitHubIdentityClient;
  let service: GitHubAccountBackfillService;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    legacyConnection = new LegacyGitHubConnection();
    identityClient = new GitHubIdentityClient();
    service = new GitHubAccountBackfillService(registry, legacyConnection, identityClient);
  });

  it('backfills the legacy GitHub token into linked accounts and sets the default', async () => {
    const account = await service.backfillLegacyToken();

    expect(account).toMatchObject({
      id: 'github.com:42',
      login: 'monalisa',
      credentialSource: 'secure_storage',
    });
    await expect(registry.resolveToken('github.com:42')).resolves.toBe('gho_monalisa');
    await expect(registry.getDefaultAccountId()).resolves.toBe('github.com:42');
    expect(identityClient.getAuthenticatedUser).toHaveBeenCalledWith('gho_monalisa', 'github.com');
    expect(legacyConnection.clearStoredToken).toHaveBeenCalled();
  });

  it('does not replace an existing default account', async () => {
    const { account: existing } = await registry.upsertAccount({
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

    await expect(registry.getDefaultAccountId()).resolves.toBe(existing.id);
  });

  it('does not backfill when the legacy token cannot identify a GitHub user', async () => {
    identityClient.user = null;

    await expect(service.backfillLegacyToken()).resolves.toBeNull();

    await expect(registry.listAccounts()).resolves.toEqual([]);
    await expect(registry.getDefaultAccountId()).resolves.toBeNull();
    expect(legacyConnection.clearStoredToken).not.toHaveBeenCalled();
  });

  it('does not backfill when no stored legacy token exists', async () => {
    legacyConnection.token = null;

    await expect(service.backfillLegacyToken()).resolves.toBeNull();

    expect(identityClient.getAuthenticatedUser).not.toHaveBeenCalled();
    await expect(registry.listAccounts()).resolves.toEqual([]);
  });

  it('uses CLI as the credential source when the legacy token came from GitHub CLI', async () => {
    legacyConnection.source = 'cli';

    await expect(service.backfillLegacyToken()).resolves.toMatchObject({
      id: 'github.com:42',
      credentialSource: 'cli',
    });
  });
});

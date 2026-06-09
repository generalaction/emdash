import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderTokenPayload } from '@main/core/account/provider-token-registry';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';
import { GitHubAuthServerAdapter } from './github-auth-server-adapter';

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

describe('GitHubAuthServerAdapter', () => {
  let registry: GitHubAccountRegistry;
  let adapter: GitHubAuthServerAdapter;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    adapter = new GitHubAuthServerAdapter(registry);
  });

  it('stores auth-server tokens with provider account metadata in the account registry only', async () => {
    const payload: ProviderTokenPayload = {
      accessToken: 'gho_monalisa',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      },
    };

    await adapter.storeOAuthToken(payload);

    const accounts = await registry.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: 'github.com:42',
      login: 'monalisa',
      credentialSource: 'emdash_oauth',
    });
    await expect(registry.resolveToken('github.com:42')).resolves.toBe('gho_monalisa');
  });

  it('stores linked provider accounts in the account registry', async () => {
    const payload: ProviderTokenPayload = {
      accessToken: 'gho_octocat',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '84',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/84',
      },
    };

    await adapter.storeOAuthToken(payload);

    const accounts = await registry.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: 'github.com:84',
      login: 'octocat',
      credentialSource: 'emdash_oauth',
    });
    await expect(registry.resolveToken('github.com:84')).resolves.toBe('gho_octocat');
  });

  it('does not store tokens when auth-server metadata is absent', async () => {
    await adapter.storeOAuthToken({ accessToken: 'gho_legacy' });

    await expect(registry.listAccounts()).resolves.toEqual([]);
  });
});

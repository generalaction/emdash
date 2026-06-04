import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderTokenPayload } from '@main/core/account/provider-token-registry';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';
import { GitHubAuthServerAdapter } from './github-auth-server-adapter';

class InMemoryMetadataStore implements GitHubAccountMetadataStore {
  accounts = null as Awaited<ReturnType<GitHubAccountMetadataStore['get']>>;

  async get() {
    return this.accounts;
  }

  async set(accounts: NonNullable<typeof this.accounts>) {
    this.accounts = accounts;
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

class LegacyGitHubTokenStore {
  stored: Array<{ token: string; source: 'emdash_oauth' }> = [];

  async storeToken(token: string, source: 'emdash_oauth') {
    this.stored.push({ token, source });
  }
}

describe('GitHubAuthServerAdapter', () => {
  let registry: GitHubAccountRegistry;
  let legacyStore: LegacyGitHubTokenStore;
  let adapter: GitHubAuthServerAdapter;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    legacyStore = new LegacyGitHubTokenStore();
    adapter = new GitHubAuthServerAdapter(registry, legacyStore);
  });

  it('stores auth-server tokens with provider account metadata in the account registry and legacy token store', async () => {
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
    expect(legacyStore.stored).toEqual([{ token: 'gho_monalisa', source: 'emdash_oauth' }]);
  });

  it('falls back to legacy token storage when auth-server metadata is absent', async () => {
    await adapter.storeOAuthToken({ accessToken: 'gho_legacy' });

    await expect(registry.listAccounts()).resolves.toEqual([]);
    expect(legacyStore.stored).toEqual([{ token: 'gho_legacy', source: 'emdash_oauth' }]);
  });
});

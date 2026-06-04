import { beforeEach, describe, expect, it } from 'vitest';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';

class InMemoryMetadataStore implements GitHubAccountMetadataStore {
  value: unknown = null;

  async get() {
    return this.value as never;
  }

  async set(value: unknown) {
    this.value = value;
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

describe('GitHubAccountRegistry', () => {
  let metadataStore: InMemoryMetadataStore;
  let secretStore: InMemorySecretStore;
  let registry: GitHubAccountRegistry;

  beforeEach(() => {
    metadataStore = new InMemoryMetadataStore();
    secretStore = new InMemorySecretStore();
    registry = new GitHubAccountRegistry(metadataStore, secretStore);
  });

  it('stores OAuth account metadata separately from the account token', async () => {
    const account = await registry.upsertAccount({
      accessToken: 'gho_monalisa',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      },
    });

    await expect(registry.resolveToken(account.id)).resolves.toBe('gho_monalisa');
    await expect(registry.listAccounts()).resolves.toEqual([
      {
        id: 'github.com:42',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        credentialSource: 'emdash_oauth',
        connectedAt: account.connectedAt,
        updatedAt: account.updatedAt,
      },
    ]);
  });

  it('updates an existing account instead of duplicating it', async () => {
    await registry.upsertAccount({
      accessToken: 'old-token',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
      },
    });

    const updated = await registry.upsertAccount({
      accessToken: 'new-token',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'mona',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      },
    });

    await expect(registry.resolveToken(updated.id)).resolves.toBe('new-token');
    const accounts = await registry.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: 'github.com:42',
      login: 'mona',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
    });
  });

  it('removes account metadata and credentials together', async () => {
    const account = await registry.upsertAccount({
      accessToken: 'gho_monalisa',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
      },
    });

    await registry.removeAccount(account.id);

    await expect(registry.listAccounts()).resolves.toEqual([]);
    await expect(registry.resolveToken(account.id)).resolves.toBeNull();
  });
});

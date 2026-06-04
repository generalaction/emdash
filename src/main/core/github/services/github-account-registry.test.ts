import { beforeEach, describe, expect, it } from 'vitest';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';

class InMemoryMetadataStore implements GitHubAccountMetadataStore {
  accounts: unknown = null;
  defaultAccountId: string | null = null;

  async getAccounts() {
    return this.accounts as never;
  }

  async setAccounts(value: unknown) {
    this.accounts = value;
  }

  async getDefaultAccountId() {
    return this.defaultAccountId;
  }

  async setDefaultAccountId(accountId: string | null) {
    this.defaultAccountId = accountId;
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

  async function upsertAccount(login: string, providerAccountId: string, host = 'github.com') {
    return registry.upsertAccount({
      accessToken: `gho_${login}`,
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId,
        host,
        login,
        avatarUrl: '',
      },
    });
  }

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

  it('sets the first linked account as the default account', async () => {
    const account = await upsertAccount('monalisa', '42');

    await expect(registry.getDefaultAccountId()).resolves.toBe(account.id);
  });

  it('does not replace the default account when another account is linked', async () => {
    const first = await upsertAccount('monalisa', '42');
    await upsertAccount('octocat', '84');

    await expect(registry.getDefaultAccountId()).resolves.toBe(first.id);
  });

  it('allows explicitly changing the default account to a linked account', async () => {
    await upsertAccount('monalisa', '42');
    const second = await upsertAccount('octocat', '84');

    await expect(registry.setDefaultAccountId(second.id)).resolves.toEqual(second);
    await expect(registry.getDefaultAccountId()).resolves.toBe(second.id);
  });

  it('does not set the default account to an unknown account id', async () => {
    await upsertAccount('monalisa', '42');

    await expect(registry.setDefaultAccountId('github.com:unknown')).resolves.toBeNull();
    await expect(registry.getDefaultAccountId()).resolves.toBe('github.com:42');
  });

  it('repairs an invalid stored default account to the oldest linked account', async () => {
    const first = await upsertAccount('monalisa', '42');
    await upsertAccount('octocat', '84');
    metadataStore.defaultAccountId = 'github.com:missing';

    await expect(registry.getDefaultAccountId()).resolves.toBe(first.id);
    expect(metadataStore.defaultAccountId).toBe(first.id);
  });

  it('uses the oldest account as default when a new account is linked and the stored default is invalid', async () => {
    const first = await upsertAccount('monalisa', '42');
    metadataStore.defaultAccountId = 'github.com:missing';

    await upsertAccount('octocat', '84');

    await expect(registry.getDefaultAccountId()).resolves.toBe(first.id);
  });

  it('moves the default account to the oldest remaining account when the default is removed', async () => {
    const first = await upsertAccount('monalisa', '42');
    const second = await upsertAccount('octocat', '84');
    const third = await upsertAccount('hubot', '168');
    await registry.setDefaultAccountId(second.id);

    await registry.removeAccount(second.id);

    await expect(registry.getDefaultAccountId()).resolves.toBe(first.id);
    await expect(registry.resolveToken(second.id)).resolves.toBeNull();
    await expect(registry.resolveToken(third.id)).resolves.toBe('gho_hubot');
  });

  it('clears the default account when the last account is removed', async () => {
    const account = await upsertAccount('monalisa', '42');

    await registry.removeAccount(account.id);

    await expect(registry.getDefaultAccountId()).resolves.toBeNull();
    expect(metadataStore.defaultAccountId).toBeNull();
  });

  it('stores accounts with the same provider account id on different hosts separately', async () => {
    const githubDotCom = await upsertAccount('monalisa', '42', 'github.com');
    const enterprise = await upsertAccount('enterprise-monalisa', '42', 'ghe.example.com');

    expect(githubDotCom.id).toBe('github.com:42');
    expect(enterprise.id).toBe('ghe.example.com:42');
    await expect(registry.listAccounts()).resolves.toHaveLength(2);
  });

  it('normalizes www.github.com account hosts to github.com', async () => {
    const account = await upsertAccount('monalisa', '42', 'www.github.com');

    expect(account.id).toBe('github.com:42');
    expect(account.host).toBe('github.com');
  });
});

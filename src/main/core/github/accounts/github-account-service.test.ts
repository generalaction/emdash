import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubAccountRegistry,
  type GitHubAccount,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';
import { GitHubAccountService } from './github-account-service';

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

describe('GitHubAccountService', () => {
  let registry: GitHubAccountRegistry;
  let service: GitHubAccountService;
  let importCliAccounts: () => Promise<GitHubAccount[]>;
  let clearOctokitCache: (host?: string, accountId?: string) => void;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    importCliAccounts = async () => [];
    clearOctokitCache = vi.fn();
    service = new GitHubAccountService(
      registry,
      {
        importAccounts: () => importCliAccounts(),
      },
      clearOctokitCache
    );
  });

  async function upsertAccount(login: string, providerAccountId: string, host = 'github.com') {
    return registry.upsertAccount({
      accessToken: `token-${host}-${providerAccountId}`,
      credentialSource: host === 'github.com' ? 'emdash_oauth' : 'cli',
      providerAccount: {
        providerId: 'github',
        providerAccountId,
        host,
        login,
        avatarUrl: `https://${host}/avatars/${providerAccountId}`,
      },
    });
  }

  it('lists linked accounts with exactly one default account marker', async () => {
    const first = await upsertAccount('monalisa', '42');
    const second = await upsertAccount('enterprise-monalisa', '42', 'ghe.example.com');
    await registry.setDefaultAccountId(second.id);

    await expect(service.listAccounts()).resolves.toEqual([
      {
        accountId: first.id,
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: 'https://github.com/avatars/42',
        credentialSource: 'emdash_oauth',
        isDefault: false,
      },
      {
        accountId: second.id,
        host: 'ghe.example.com',
        login: 'enterprise-monalisa',
        avatarUrl: 'https://ghe.example.com/avatars/42',
        credentialSource: 'cli',
        isDefault: true,
      },
    ]);
  });

  it('returns null instead of changing the default for an unknown account id', async () => {
    const account = await upsertAccount('monalisa', '42');

    await expect(service.setDefaultAccount('github.com:missing')).resolves.toBeNull();
    await expect(registry.getDefaultAccountId()).resolves.toBe(account.id);
  });

  it('imports CLI accounts and returns the refreshed account list', async () => {
    const existing = await upsertAccount('monalisa', '42');
    importCliAccounts = async () => [
      await registry.upsertAccount({
        accessToken: 'token-ghe',
        credentialSource: 'cli',
        providerAccount: {
          providerId: 'github',
          providerAccountId: '168',
          host: 'ghe.example.com',
          login: 'enterprise',
          avatarUrl: 'https://ghe.example.com/avatars/168',
        },
      }),
    ];

    const result = await service.importCliAccounts();

    expect(result.importedAccountIds).toEqual(['ghe.example.com:168']);
    expect(result.accounts).toMatchObject([
      { accountId: existing.id, login: 'monalisa', isDefault: true },
      { accountId: 'ghe.example.com:168', login: 'enterprise', isDefault: false },
    ]);
    await expect(registry.resolveToken('ghe.example.com:168')).resolves.toBe('token-ghe');
  });

  it('deduplicates imported account ids returned by the CLI importer', async () => {
    importCliAccounts = async () => {
      const account = await upsertAccount('monalisa', '42');
      return [account, account];
    };

    const result = await service.importCliAccounts();

    expect(result.importedAccountIds).toEqual(['github.com:42']);
  });

  it('returns the fallback default when removing the default account', async () => {
    const first = await upsertAccount('monalisa', '42');
    const second = await upsertAccount('octocat', '84');
    await registry.setDefaultAccountId(second.id);

    const accounts = await service.removeAccount(second.id);

    expect(accounts).toMatchObject([{ accountId: first.id, isDefault: true }]);
    await expect(registry.resolveToken(second.id)).resolves.toBeNull();
    expect(clearOctokitCache).toHaveBeenCalledWith('github.com', second.id);
  });

  it('returns null when removing an unknown account id', async () => {
    await upsertAccount('monalisa', '42');

    await expect(service.removeAccount('github.com:missing')).resolves.toBeNull();
    await expect(service.listAccounts()).resolves.toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from '@shared/result';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from '../accounts/github-account-registry';
import { GitHubApiAuthService } from './github-api-auth-service';

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

describe('GitHubApiAuthService', () => {
  let registry: GitHubAccountRegistry;
  let secretStore: InMemorySecretStore;
  let service: GitHubApiAuthService;

  beforeEach(() => {
    secretStore = new InMemorySecretStore();
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), secretStore);
    service = new GitHubApiAuthService(registry);
  });

  async function upsertAccount({
    host = 'github.com',
    providerAccountId = '42',
    login = 'monalisa',
    token = `token-${providerAccountId}`,
  }: {
    host?: string;
    providerAccountId?: string;
    login?: string;
    token?: string;
  } = {}) {
    return registry.upsertAccount({
      accessToken: token,
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

  it('uses the selected GitHub.com account token when an account id is provided', async () => {
    await upsertAccount({ providerAccountId: '42', token: 'selected-account-token' });

    await expect(service.getToken('github.com', { accountId: 'github.com:42' })).resolves.toEqual(
      ok('selected-account-token')
    );
  });

  it('uses the selected GitHub Enterprise account token when an account id is provided', async () => {
    await upsertAccount({
      host: 'ghe.example.com',
      providerAccountId: '168',
      login: 'enterprise',
      token: 'selected-ghes-account-token',
    });

    await expect(
      service.getToken('GHE.EXAMPLE.COM', {
        accountId: 'ghe.example.com:168',
      })
    ).resolves.toEqual(ok('selected-ghes-account-token'));
  });

  it('returns account not found when the selected account is missing', async () => {
    await upsertAccount({ providerAccountId: '84' });

    await expect(service.getToken('github.com', { accountId: 'github.com:42' })).resolves.toEqual(
      err({
        type: 'account_not_found',
        host: 'github.com',
        accountId: 'github.com:42',
        message: 'Selected GitHub account is no longer connected: github.com:42.',
        hint: 'Connect GitHub from account settings.',
      })
    );
  });

  it('returns account host mismatch when the selected account host does not match the requested host', async () => {
    await upsertAccount({ providerAccountId: '42' });

    await expect(
      service.getToken('ghe.example.com', { accountId: 'github.com:42' })
    ).resolves.toEqual(
      err({
        type: 'account_host_mismatch',
        host: 'ghe.example.com',
        accountId: 'github.com:42',
        accountHost: 'github.com',
        message:
          'Selected GitHub account github.com:42 is for github.com, but this repository uses ghe.example.com.',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('returns token missing when the selected account token is missing', async () => {
    const account = await upsertAccount({ providerAccountId: '42' });
    await secretStore.deleteSecret(`github-account-token:${account.id}`);

    await expect(service.getToken('github.com', { accountId: 'github.com:42' })).resolves.toEqual(
      err({
        type: 'token_missing',
        host: 'github.com',
        accountId: 'github.com:42',
        message: 'Selected GitHub account github.com:42 is missing a saved token.',
        hint: 'Connect GitHub from account settings.',
      })
    );
  });

  it('uses the default account when no account id is provided and the default host matches', async () => {
    await upsertAccount({ providerAccountId: '42', token: 'default-account-token' });

    await expect(service.getToken('www.github.com')).resolves.toEqual(ok('default-account-token'));
  });

  it('uses a default GitHub Enterprise account when no account id is provided and the host matches', async () => {
    await upsertAccount({
      host: 'ghe.example.com',
      providerAccountId: '168',
      login: 'enterprise',
      token: 'default-ghes-token',
    });

    await expect(service.getToken('ghe.example.com')).resolves.toEqual(ok('default-ghes-token'));
  });

  it('does not use the default account when no account id is provided and the host differs', async () => {
    await upsertAccount({ providerAccountId: '42' });

    await expect(service.getToken('ghe.example.com')).resolves.toEqual(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message:
          'GitHub Enterprise authentication required for ghe.example.com. Run: gh auth login --hostname ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('returns a GHES login hint when no account is selected for an enterprise host', async () => {
    await expect(service.getToken('ghe.example.com')).resolves.toEqual(
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

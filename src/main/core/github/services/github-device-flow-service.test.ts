import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubUser } from '@shared/github';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from '../accounts/github-account-registry';
import { GitHubDeviceFlowService } from './github-device-flow-service';

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

const user: GitHubUser = {
  id: 42,
  login: 'monalisa',
  name: 'Mona Lisa',
  email: '',
  avatar_url: 'https://avatars.githubusercontent.com/u/42',
};

describe('GitHubDeviceFlowService', () => {
  let registry: GitHubAccountRegistry;
  let getAuthenticatedUser: (token: string, host?: string) => Promise<GitHubUser | null>;
  let emit: (channel: unknown, payload: unknown) => void;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    getAuthenticatedUser = vi.fn(async () => user);
    emit = vi.fn();
  });

  it('registers a device-flow account in the registry', async () => {
    const service = new GitHubDeviceFlowService({
      accountRegistry: registry,
      identityClient: { getAuthenticatedUser },
      events: { emit },
      createDeviceAuth: () => async () => ({ token: 'gho_device' }),
    });

    await expect(service.start()).resolves.toMatchObject({
      success: true,
      user,
      account: {
        id: 'github.com:42',
        credentialSource: 'device_flow',
      },
    });
    await expect(registry.resolveToken('github.com:42')).resolves.toBe('gho_device');
  });

  it('returns an error when the device-flow token cannot identify a user', async () => {
    getAuthenticatedUser = vi.fn(async () => null);
    const service = new GitHubDeviceFlowService({
      accountRegistry: registry,
      identityClient: { getAuthenticatedUser },
      events: { emit },
      createDeviceAuth: () => async () => ({ token: 'gho_device' }),
    });

    await expect(service.start()).resolves.toEqual({
      success: false,
      error: 'Failed to read authenticated GitHub user',
    });
    await expect(registry.listAccounts()).resolves.toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { GitHubUser } from '@shared/github';
import {
  GitHubAccountRegistry,
  type GitHubAccountMetadataStore,
  type GitHubAccountSecretStore,
} from './github-account-registry';
import { GitHubCliAccountImportService } from './github-cli-account-import';

class InMemoryMetadataStore implements GitHubAccountMetadataStore {
  accounts = null as Awaited<ReturnType<GitHubAccountMetadataStore['getAccounts']>>;
  defaultAccountId: string | null = null;

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

function makeGitHubUser(id: number, login: string): GitHubUser {
  return {
    id,
    login,
    name: login,
    email: '',
    avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
  };
}

function makeCtx(stdout: string): Pick<IExecutionContext, 'exec'> {
  return {
    exec: vi.fn().mockResolvedValue({ stdout, stderr: '' }),
  };
}

describe('GitHubCliAccountImportService', () => {
  let registry: GitHubAccountRegistry;
  let usersByToken: Map<string, GitHubUser>;
  let getUserInfo: ReturnType<
    typeof vi.fn<(token: string, host?: string) => Promise<GitHubUser | null>>
  >;

  beforeEach(() => {
    registry = new GitHubAccountRegistry(new InMemoryMetadataStore(), new InMemorySecretStore());
    usersByToken = new Map([
      ['gho_monalisa', makeGitHubUser(42, 'monalisa')],
      ['gho_octocat', makeGitHubUser(84, 'octocat')],
      ['ghes_enterprise', makeGitHubUser(168, 'enterprise')],
    ]);
    getUserInfo = vi.fn<(token: string, host?: string) => Promise<GitHubUser | null>>(
      async (token: string) => usersByToken.get(token) ?? null
    );
  });

  function makeService(stdout: string) {
    return new GitHubCliAccountImportService(registry, makeCtx(stdout), { getUserInfo });
  }

  it('imports every GitHub.com account reported by GitHub CLI as linked accounts', async () => {
    const service = makeService(
      JSON.stringify({
        hosts: {
          'github.com': [
            {
              state: 'success',
              active: true,
              host: 'github.com',
              login: 'monalisa',
              token: 'gho_monalisa',
            },
            {
              state: 'success',
              active: false,
              host: 'github.com',
              login: 'octocat',
              token: 'gho_octocat',
            },
          ],
        },
      })
    );

    const imported = await service.importAccounts();

    expect(imported.map((account) => account.id)).toEqual(['github.com:42', 'github.com:84']);
    await expect(registry.resolveToken('github.com:42')).resolves.toBe('gho_monalisa');
    await expect(registry.resolveToken('github.com:84')).resolves.toBe('gho_octocat');
    await expect(registry.getDefaultAccountId()).resolves.toBe('github.com:42');
  });

  it('bounds the GitHub CLI status call so startup cannot hang indefinitely', async () => {
    const ctx = makeCtx(JSON.stringify({ hosts: {} }));
    const service = new GitHubCliAccountImportService(registry, ctx, { getUserInfo });

    await service.importAccounts();

    expect(ctx.exec).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status', '--json', 'hosts', '--show-token'],
      { timeout: 5_000 }
    );
  });

  it('keeps existing linked accounts that are no longer reported by GitHub CLI', async () => {
    await registry.upsertAccount({
      accessToken: 'gho_existing',
      credentialSource: 'cli',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '168',
        host: 'github.com',
        login: 'hubot',
        avatarUrl: '',
      },
    });

    const service = makeService(
      JSON.stringify({
        hosts: {
          'github.com': [
            {
              state: 'success',
              active: true,
              host: 'github.com',
              login: 'monalisa',
              token: 'gho_monalisa',
            },
          ],
        },
      })
    );

    await service.importAccounts();

    await expect(registry.listAccounts()).resolves.toHaveLength(2);
    await expect(registry.resolveToken('github.com:168')).resolves.toBe('gho_existing');
  });

  it('ignores CLI entries that cannot be resolved to a GitHub user', async () => {
    usersByToken.delete('gho_octocat');
    const service = makeService(
      JSON.stringify({
        hosts: {
          'github.com': [
            {
              state: 'success',
              active: true,
              host: 'github.com',
              login: 'monalisa',
              token: 'gho_monalisa',
            },
            {
              state: 'success',
              active: false,
              host: 'github.com',
              login: 'octocat',
              token: 'gho_octocat',
            },
          ],
        },
      })
    );

    const imported = await service.importAccounts();

    expect(imported.map((account) => account.id)).toEqual(['github.com:42']);
    await expect(registry.listAccounts()).resolves.toHaveLength(1);
  });

  it('imports GitHub Enterprise accounts reported by GitHub CLI', async () => {
    const service = makeService(
      JSON.stringify({
        hosts: {
          'ghe.example.com': [
            {
              state: 'success',
              active: true,
              host: 'ghe.example.com',
              login: 'enterprise',
              token: 'ghes_enterprise',
            },
          ],
        },
      })
    );

    const imported = await service.importAccounts();

    expect(imported.map((account) => account.id)).toEqual(['ghe.example.com:168']);
    expect(getUserInfo).toHaveBeenCalledWith('ghes_enterprise', 'ghe.example.com');
    await expect(registry.resolveToken('ghe.example.com:168')).resolves.toBe('ghes_enterprise');
  });

  it('uses the CLI hosts map key as the authoritative account host', async () => {
    const service = makeService(
      JSON.stringify({
        hosts: {
          'ghe.example.com': [
            {
              state: 'success',
              active: true,
              host: 'github.com',
              login: 'enterprise',
              token: 'ghes_enterprise',
            },
          ],
        },
      })
    );

    const imported = await service.importAccounts();

    expect(imported.map((account) => account.id)).toEqual(['ghe.example.com:168']);
    expect(getUserInfo).toHaveBeenCalledWith('ghes_enterprise', 'ghe.example.com');
  });
});

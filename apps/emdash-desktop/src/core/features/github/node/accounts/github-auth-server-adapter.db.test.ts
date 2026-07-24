import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderTokenPayload } from '@core/features/account/api/node/provider-token-registry';
import { GITHUB_PROVIDER_ID, toGitHubAccount } from './github-accounts';
import { GitHubAuthServerAdapter } from './github-auth-server-adapter';

describe('GitHubAuthServerAdapter', () => {
  let fixture: RegistryFixture;
  let adapter: GitHubAuthServerAdapter;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    adapter = new GitHubAuthServerAdapter(fixture.registry);
  });

  afterEach(() => {
    fixture?.close();
  });

  it('stores auth-server tokens with provider account metadata in the registry', async () => {
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

    const result = await adapter.storeOAuthToken(payload);

    const accounts = (await fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).map(toGitHubAccount);
    expect(result).toMatchObject({
      providerAccountStatus: 'created',
      providerAccount: payload.providerAccount,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: 'github.com:42',
      login: 'monalisa',
      credentialSource: 'emdash_oauth',
    });
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      'gho_monalisa'
    );
  });

  it('does not store tokens when auth-server metadata is absent', async () => {
    await adapter.storeOAuthToken({ accessToken: 'gho_legacy' });

    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
  });

  it('ignores non-GitHub provider accounts', async () => {
    await adapter.storeOAuthToken({
      accessToken: 'glpat_token',
      providerAccount: {
        providerId: 'gitlab',
        providerAccountId: '7',
        host: 'gitlab.com',
        login: 'monalisa',
        avatarUrl: '',
      },
    });

    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
  });

  it('reports updated when the OAuth account already exists', async () => {
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
    const result = await adapter.storeOAuthToken({
      ...payload,
      accessToken: 'gho_refreshed',
    });

    expect(result).toMatchObject({
      providerAccountStatus: 'updated',
      providerAccount: payload.providerAccount,
    });
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      'gho_refreshed'
    );
  });
});

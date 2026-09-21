import { ok } from '@emdash/shared';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGitHubCredentialReader,
  type ReadGitHubCredentials,
} from '@core/features/github/api/node/services/github-credentials';
import { connectGitHubAccount } from '../accounts/github-auth-connection';

describe('readGitHubCredentials', () => {
  let fixture: RegistryFixture;
  let readCredentials: ReadGitHubCredentials;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    readCredentials = createGitHubCredentialReader(fixture.integrationAccounts, fixture.registry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture?.close();
  });

  async function connect(id = '42', host = 'github.com') {
    return (
      await connectGitHubAccount(fixture.connections, {
        accessToken: `token-${id}`,
        credentialSource: 'emdash_oauth',
        providerAccount: {
          providerId: 'github',
          providerAccountId: id,
          host,
          login: `user-${id}`,
          avatarUrl: '',
        },
      })
    ).account;
  }

  it('reads only the selected account even when another account becomes default', async () => {
    const selected = await connect();
    const other = await connect('84');
    await fixture.registry.setDefaultAccount('github', other.accountId);
    await expect(readCredentials(selected.accountId, 'www.github.com')).resolves.toEqual(
      ok({ accessToken: 'token-42', apiBaseUrl: 'https://api.github.com' })
    );
  });

  it('fails if the selected account disappears, without reading another account', async () => {
    const selected = await connect();
    await connect('84');
    await fixture.registry.removeAccount('github', selected.accountId);
    const getAccount = vi.spyOn(fixture.integrationAccounts, 'getAccount');
    await expect(readCredentials(selected.accountId, 'github.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'account_not_found', accountId: selected.accountId },
    });
    expect(getAccount).toHaveBeenCalledExactlyOnceWith('github', selected.accountId);
  });

  it('rejects an empty account ID before reaching the store default lookup', async () => {
    await connect();
    const getAccount = vi.spyOn(fixture.integrationAccounts, 'getAccount');
    await expect(readCredentials('  ', 'github.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'account_not_found' },
    });
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('rejects a selected account from another host', async () => {
    const selected = await connect();
    await expect(readCredentials(selected.accountId, 'ghe.example.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'account_host_mismatch', host: 'ghe.example.com', accountHost: 'github.com' },
    });
  });

  it('reports missing credentials for an account that still exists', async () => {
    const selected = await connect();
    fixture.secretStore.secrets.clear();
    await expect(readCredentials(selected.accountId, 'github.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'token_missing', accountId: selected.accountId },
    });
  });

  it('returns the stored Enterprise endpoint and normalizes the expected host', async () => {
    const selected = await connect('42', 'ghe.example.com:8443');
    await fixture.registry.upsertAccount({
      providerId: 'github',
      accountId: selected.accountId,
      secret: JSON.stringify({
        accessToken: 'token',
        apiBaseUrl: 'https://ghe.example.com:8443/github/api/v3',
      }),
    });
    await expect(readCredentials(selected.accountId, 'GHE.EXAMPLE.COM:8443')).resolves.toEqual(
      ok({ accessToken: 'token', apiBaseUrl: 'https://ghe.example.com:8443/github/api/v3' })
    );
  });

  it('rejects a credential endpoint mismatch even when account metadata matches', async () => {
    const selected = await connect('42', 'ghe.example.com');
    await fixture.registry.upsertAccount({
      providerId: 'github',
      accountId: selected.accountId,
      secret: JSON.stringify({
        accessToken: 'token',
        apiBaseUrl: 'https://other.example.com/api/v3',
      }),
    });
    await expect(readCredentials(selected.accountId, 'ghe.example.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'account_host_mismatch', accountHost: 'other.example.com' },
    });
  });

  it.each([
    'raw-token',
    '{"accessToken":"token","apiBaseUrl":"invalid"}',
    '{"wrongField":"token"}',
  ])('fails closed on credentials outside the provider schema (%s)', async (raw) => {
    const selected = await connect();
    await fixture.registry.upsertAccount({
      providerId: 'github',
      accountId: selected.accountId,
      secret: raw,
    });
    await expect(readCredentials(selected.accountId, 'github.com')).resolves.toMatchObject({
      success: false,
      error: { type: 'token_missing' },
    });
  });
});

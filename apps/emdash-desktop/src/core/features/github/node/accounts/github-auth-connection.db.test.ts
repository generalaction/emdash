import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isGitHubAccountSummary } from '@core/primitives/github/api';
import { providerAccountContextKey } from '@core/primitives/project-settings/api';
import { providerAccounts } from '@core/services/app-db/node/schema';
import { ProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';
import { GITHUB_PROVIDER_ID, connectGitHubAccount } from './github-auth-connection';

describe('github account helpers', () => {
  let fixture: RegistryFixture;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
  });

  afterEach(() => {
    fixture?.close();
  });

  async function upsert(login: string, providerAccountId: string, host = 'github.com') {
    return connectGitHubAccount(fixture.connections, {
      accessToken: `gho_${login}`,
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId,
        host,
        login,
        avatarUrl: `https://avatars.githubusercontent.com/u/${providerAccountId}`,
      },
    });
  }

  it('stores identity metadata in the row and the token behind the credentialRef', async () => {
    const { account, status } = await upsert('monalisa', '42');

    expect(status).toBe('created');
    expect(account).toMatchObject({
      accountId: 'github.com:42',
      providerId: 'github',
      displayName: '@monalisa',
      host: 'github.com',
      login: 'monalisa',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      credentialSource: 'emdash_oauth',
    });
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      JSON.stringify({ accessToken: 'gho_monalisa', apiBaseUrl: 'https://api.github.com' })
    );
  });

  it('updates an existing account instead of duplicating it', async () => {
    await upsert('monalisa', '42');
    const { account, status } = await upsert('mona', '42');

    expect(status).toBe('updated');
    expect(account).toMatchObject({ accountId: 'github.com:42', login: 'mona' });
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toHaveLength(1);
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      JSON.stringify({ accessToken: 'gho_mona', apiBaseUrl: 'https://api.github.com' })
    );
  });

  it('normalizes www.github.com account hosts to github.com', async () => {
    const { account } = await upsert('monalisa', '42', 'www.github.com');

    expect(account.accountId).toBe('github.com:42');
    expect(account.host).toBe('github.com');
  });

  it('keeps accounts with the same provider account id on different hosts separate', async () => {
    const dotCom = await upsert('monalisa', '42', 'github.com');
    const enterprise = await upsert('enterprise-monalisa', '42', 'ghe.example.com');

    expect(dotCom.account.accountId).toBe('github.com:42');
    expect(enterprise.account.accountId).toBe('ghe.example.com:42');
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toHaveLength(2);
  });

  it('normalizes historical metadata at the registry seam for every inventory consumer', async () => {
    await upsert('monalisa', '42', 'ghe.example.com');
    await fixture.db
      .update(providerAccounts)
      .set({ meta: null })
      .where(eq(providerAccounts.accountId, 'ghe.example.com:42'));
    const inventory = await new ProviderAccountService(fixture.registry).listAccounts('github');
    expect(inventory).toEqual([
      {
        providerId: 'github',
        accountId: 'ghe.example.com:42',
        displayName: 'Account 1',
        displayDetail: 'ghe.example.com',
        host: 'ghe.example.com',
        login: '',
        avatarUrl: '',
        credentialSource: 'secure_storage',
        isDefault: true,
      },
    ]);
    expect(inventory[0]?.displayName).not.toBe('ghe.example.com:42');
    const github = inventory.filter(isGitHubAccountSummary);
    expect(github[0]).toBe(inventory[0]);
    expect(providerAccountContextKey(undefined, github)).toBe(
      providerAccountContextKey(undefined, inventory)
    );
    await expect(fixture.registry.resolveSecret('github', 'ghe.example.com:42')).resolves.toBe(
      JSON.stringify({ accessToken: 'gho_monalisa', apiBaseUrl: 'https://ghe.example.com/api/v3' })
    );
  });
});

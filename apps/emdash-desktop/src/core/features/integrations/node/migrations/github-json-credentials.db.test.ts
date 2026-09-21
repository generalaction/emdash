import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateGitHubJsonCredentials } from './github-json-credentials';

describe('GitHub credential JSON migration', () => {
  let fixture: RegistryFixture;
  beforeEach(async () => {
    fixture = await openRegistryFixture();
  });
  afterEach(() => fixture.close());

  async function seed(host = 'github.com', token = 'legacy-token') {
    return (
      await fixture.registry.upsertAccount({
        providerId: 'github',
        accountId: `${host}:42`,
        secret: token,
        credentialRef: `existing-ref:${host}`,
        meta: {
          host,
          providerAccountId: '42',
          login: 'ada',
          label: 'Work',
          credentialSource: 'cli',
        },
      })
    ).account;
  }

  it('preserves account IDs, defaults, metadata, and secret references across an offline upgrade', async () => {
    const dotcom = await seed();
    await seed('ghe.example.com', 'enterprise-token');
    await fixture.registry.setDefaultAccount('github', 'ghe.example.com:42');
    const enterprise = await fixture.registry.getAccount('github', 'ghe.example.com:42');

    await migrateGitHubJsonCredentials(fixture.registry);

    expect(await fixture.registry.getAccount('github', dotcom.accountId)).toEqual({
      ...dotcom,
      isDefault: false,
      updatedAt: expect.any(Number),
    });
    expect(await fixture.registry.getAccount('github', 'ghe.example.com:42')).toEqual({
      ...enterprise,
      updatedAt: expect.any(Number),
    });
    expect(
      (await fixture.integrationAccounts.getAccount('github', dotcom.accountId))?.credentials
    ).toEqual({
      accessToken: 'legacy-token',
      apiBaseUrl: 'https://api.github.com',
    });
    expect((await fixture.integrationAccounts.getAccount('github'))?.credentials).toEqual({
      accessToken: 'enterprise-token',
      apiBaseUrl: 'https://ghe.example.com/api/v3',
    });
    const write = vi.spyOn(fixture.secretStore, 'setSecret');
    await migrateGitHubJsonCredentials(fixture.registry);
    expect(write).not.toHaveBeenCalled();
  });

  it('retries a failed write without deleting the old token', async () => {
    const account = await seed();
    vi.spyOn(fixture.secretStore, 'setSecret').mockRejectedValueOnce(new Error('locked'));
    await expect(migrateGitHubJsonCredentials(fixture.registry)).rejects.toThrow('locked');
    expect(await fixture.registry.resolveSecret('github', account.accountId)).toBe('legacy-token');
    await migrateGitHubJsonCredentials(fixture.registry);
    expect((await fixture.integrationAccounts.getAccount('github'))?.credentials.accessToken).toBe(
      'legacy-token'
    );
  });

  it.each(['{"accessToken":', '{"wrongField":"secret"}', '[]', '"json-string"'])(
    'does not reinterpret corrupt or incompatible JSON as a raw token (%s)',
    async (raw) => {
      const account = await seed('github.com', raw);
      await migrateGitHubJsonCredentials(fixture.registry);
      expect(await fixture.registry.resolveSecret('github', account.accountId)).toBe(raw);
      expect(await fixture.integrationAccounts.getAccount('github')).toBeNull();
    }
  );

  it('does not recreate missing secrets or accounts', async () => {
    const account = await seed();
    fixture.secretStore.secrets.delete(account.credentialRef);
    await migrateGitHubJsonCredentials(fixture.registry);
    expect(await fixture.integrationAccounts.getAccount('github')).toBeNull();
    await fixture.registry.removeAccount('github', account.accountId);
    await migrateGitHubJsonCredentials(fixture.registry);
    expect(await fixture.registry.listAccounts('github')).toEqual([]);
    expect(fixture.secretStore.secrets.size).toBe(0);
  });
});

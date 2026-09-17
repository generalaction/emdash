import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerAccounts } from '@core/services/app-db/node/schema';
import { ProviderAccountService } from './provider-account-service';

describe('ProviderAccountService', () => {
  let fixture: RegistryFixture;
  const removed = vi.fn();
  const accountsChanged = vi.fn();
  let service: ProviderAccountService;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openRegistryFixture();
    service = new ProviderAccountService(fixture.registry, {
      onRemoved: removed,
      onAccountsChanged: accountsChanged,
    });
  });
  afterEach(() => fixture?.close());

  it('keeps unnamed identities distinguishable through reconnects and account lifecycle changes', async () => {
    const connect = (id: string) =>
      fixture.connections.connectVerified('notion', {
        connected: true,
        account: { id },
        credentials: { apiToken: `token-${id}` },
      });
    const first = await connect('bot-one');
    const second = await connect('bot-two');
    if (!first.success || !second.success) throw new Error('Connection failed');
    expect(first.account.displayName).toBe('Account 1');
    expect(second.account.displayName).toBe('Account 2');
    const before = await fixture.registry.getAccount('notion', second.accountId);

    await service.setDefaultAccount('notion', second.accountId);
    expect((await service.listAccounts('notion')).map((account) => account.displayName)).toEqual([
      'Account 2',
      'Account 1',
    ]);
    await service.removeAccount('notion', first.accountId);
    await expect(connect('bot-two')).resolves.toMatchObject({
      account: { accountId: second.accountId, displayName: 'Account 2' },
    });
    expect((await service.listAccounts('notion'))[0]?.displayName).toBe('Account 2');
    expect((await fixture.registry.getAccount('notion', second.accountId))?.credentialRef).toBe(
      before?.credentialRef
    );
  });

  it('assigns names to legacy unnamed accounts without overwriting secrets or user labels', async () => {
    await fixture.registry.upsertAccount({
      providerId: 'forgejo',
      accountId: 'named',
      secret: 'named-secret',
      meta: { label: 'Account 1' },
    });
    await fixture.registry.upsertAccount({
      providerId: 'forgejo',
      accountId: 'codeberg.org:985170',
      secret: 'legacy-secret',
    });
    fixture.db
      .update(providerAccounts)
      .set({ meta: null })
      .where(eq(providerAccounts.accountId, 'codeberg.org:985170'))
      .run();

    const inventory = await service.listAccounts('forgejo');
    expect(inventory.map((account) => account.displayName)).toEqual(['Account 1', 'Account 2']);
    const stored = fixture.db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.accountId, 'codeberg.org:985170'))
      .get();
    expect(stored?.meta).toMatchObject({ fallbackDisplayName: 'Account 2' });
    await expect(fixture.registry.resolveSecret('forgejo', 'codeberg.org:985170')).resolves.toBe(
      'legacy-secret'
    );
  });

  it.each(['github', 'jira'])('applies the same account lifecycle to %s', async (providerId) => {
    await fixture.registry.upsertAccount({ providerId, accountId: 'a', secret: 'one' });
    await fixture.registry.upsertAccount({ providerId, accountId: 'b', secret: 'two' });
    expect(await service.setDefaultAccount(providerId, 'missing')).toBeNull();
    expect(accountsChanged).not.toHaveBeenCalled();
    expect((await service.setDefaultAccount(providerId, 'b'))?.isDefault).toBe(true);
    expect(accountsChanged).toHaveBeenCalledExactlyOnceWith(providerId);
    await service.removeAccount(providerId, 'b');
    expect(await fixture.registry.getDefaultAccountId(providerId)).toBe('a');
    expect(await fixture.registry.resolveSecret(providerId, 'b')).toBeNull();
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({ providerId, accountId: 'b' }));
    expect(await service.removeAccount(providerId, 'missing')).toBeNull();
    expect(removed).toHaveBeenCalledTimes(1);
    expect(accountsChanged).toHaveBeenCalledTimes(2);
    expect(accountsChanged).toHaveBeenLastCalledWith(providerId);
  });

  it('does not publish changes when default selection or removal fails', async () => {
    vi.spyOn(fixture.registry, 'setDefaultAccount').mockRejectedValueOnce(
      new Error('Write failed')
    );
    vi.spyOn(fixture.registry, 'removeAccount').mockRejectedValueOnce(new Error('Write failed'));
    await expect(service.setDefaultAccount('github', 'a')).rejects.toThrow('Write failed');
    await expect(service.removeAccount('github', 'a')).rejects.toThrow('Write failed');
    expect(accountsChanged).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });
});

import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

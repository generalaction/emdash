import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('ProviderAccountRegistry concurrency', () => {
  let fixture: RegistryFixture;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
  });
  afterEach(() => fixture?.close());

  it('reports exactly one created across concurrent upserts of the same account', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fixture.registry.upsertAccount({
          providerId: 'linear',
          accountId: 'linear:acme',
          secret: `tok-${i}`,
        })
      )
    );

    const created = results.filter((r) => r.status === 'created');
    expect(created).toHaveLength(1);
    await expect(fixture.registry.listAccounts('linear')).resolves.toHaveLength(1);
  });

  it('never leaves a row without its secret under remove/reconnect interleaving', async () => {
    await fixture.registry.upsertAccount({
      providerId: 'linear',
      accountId: 'linear:acme',
      secret: 'tok-initial',
    });

    for (let i = 0; i < 10; i++) {
      await Promise.all([
        fixture.registry.removeAccount('linear', 'linear:acme'),
        fixture.registry.upsertAccount({
          providerId: 'linear',
          accountId: 'linear:acme',
          secret: `tok-${i}`,
        }),
      ]);

      const rows = await fixture.registry.listAccounts('linear');
      if (rows.length > 0) {
        // If the row survived, its secret must too — never a torn state.
        await expect(
          fixture.registry.resolveSecret('linear', 'linear:acme')
        ).resolves.not.toBeNull();
      }
    }
  });
});

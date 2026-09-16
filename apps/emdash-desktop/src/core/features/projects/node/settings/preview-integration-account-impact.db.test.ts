import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  projects as projectsTable,
  projectSettings as projectSettingsTable,
} from '@core/services/app-db/node/schema';
import { previewIntegrationAccountImpact } from './preview-integration-account-impact';

describe('previewIntegrationAccountImpact (real SQLite)', () => {
  let fixture: RegistryFixture;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    const db = fixture.db;
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      db.insert(projectsTable).values({ id, name: id }).run();
    }
    const pin = (accountId: string) =>
      JSON.stringify({ issueTrackerAccounts: { linear: { kind: 'account', accountId } } });
    db.insert(projectSettingsTable)
      .values([
        { projectId: 'p1', baseProjectSettingsJson: pin('linear:acme') },
        { projectId: 'p2', baseProjectSettingsJson: pin('linear:beta') },
        {
          projectId: 'p3',
          baseProjectSettingsJson: JSON.stringify({
            issueTrackerAccounts: { linear: { kind: 'none' } },
          }),
        },
        { projectId: 'p5', baseProjectSettingsJson: JSON.stringify({ baseRemote: 'origin' }) },
      ])
      .run();
    // p4 intentionally has no settings row (a default-follower).
  });
  afterEach(() => fixture?.close());

  const deps = (defaultId: string | null) => ({ getDefaultAccountId: async () => defaultId });

  it('counts explicit pins plus default-followers when removing the default', async () => {
    const impact = await previewIntegrationAccountImpact(fixture.db, deps('linear:acme'), {
      integrationId: 'linear',
      accountId: 'linear:acme',
    });
    expect(impact).toEqual({ isDefault: true, pinnedCount: 1, defaultFollowerCount: 2 });
  });

  it('counts only explicit pins for a non-default account', async () => {
    const impact = await previewIntegrationAccountImpact(fixture.db, deps('linear:acme'), {
      integrationId: 'linear',
      accountId: 'linear:beta',
    });
    expect(impact).toEqual({ isDefault: false, pinnedCount: 1, defaultFollowerCount: 0 });
  });
});

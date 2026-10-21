import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectSettings, projects } from '@core/services/app-db/node/schema';
import { countProjectsUsingProviderAccount } from './count-projects-using-provider-account';

const GITHUB_ACCOUNT_ID = 'github.com:42';
const JIRA_ACCOUNT_ID = 'acme.atlassian.net:abc';

describe('countProjectsUsingProviderAccount', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  async function seed(rows: { id: string; settings: unknown }[]) {
    await fixture.db.insert(projects).values(rows.map((row) => ({ id: row.id, name: row.id })));
    await fixture.db.insert(projectSettings).values(
      rows.map((row) => ({
        projectId: row.id,
        baseProjectSettingsJson:
          typeof row.settings === 'string' ? row.settings : JSON.stringify(row.settings),
      }))
    );
  }

  it('counts explicit pins in the current integrationAccounts map for any provider', async () => {
    await seed([
      {
        id: 'jira-pin',
        settings: {
          integrationAccounts: { jira: { kind: 'account', accountId: JIRA_ACCOUNT_ID } },
        },
      },
      { id: 'jira-none', settings: { integrationAccounts: { jira: { kind: 'none' } } } },
      {
        id: 'github-map-pin',
        settings: {
          integrationAccounts: { github: { kind: 'account', accountId: GITHUB_ACCOUNT_ID } },
        },
      },
      { id: 'unconfigured', settings: { baseRemote: 'origin' } },
    ]);

    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'jira', JIRA_ACCOUNT_ID)
    ).resolves.toBe(1);
    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'github', GITHUB_ACCOUNT_ID)
    ).resolves.toBe(1);
    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'linear', JIRA_ACCOUNT_ID)
    ).resolves.toBe(0);
  });

  it('reads unmigrated GitHub rows through both legacy shapes', async () => {
    await seed([
      {
        id: 'legacy-stored',
        settings: { githubAccount: { kind: 'account', accountId: GITHUB_ACCOUNT_ID } },
      },
      { id: 'legacy-stored-none', settings: { githubAccount: { kind: 'none' } } },
      { id: 'ancient', settings: { githubAccountId: GITHUB_ACCOUNT_ID } },
      { id: 'ancient-padded', settings: { githubAccountId: ` ${GITHUB_ACCOUNT_ID} ` } },
      { id: 'ancient-null', settings: { githubAccountId: null } },
    ]);

    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'github', GITHUB_ACCOUNT_ID)
    ).resolves.toBe(3);
  });

  it('the map entry wins over legacy keys, matching foldLegacyGithubAccount', async () => {
    await seed([
      {
        // Map pins another account; the legacy pin must not be counted.
        id: 'map-wins',
        settings: {
          integrationAccounts: { github: { kind: 'account', accountId: 'github.com:other' } },
          githubAccount: { kind: 'account', accountId: GITHUB_ACCOUNT_ID },
        },
      },
      {
        // Map explicitly suppresses GitHub; the legacy pin must not resurface.
        id: 'map-none-wins',
        settings: {
          integrationAccounts: { github: { kind: 'none' } },
          githubAccount: { kind: 'account', accountId: GITHUB_ACCOUNT_ID },
        },
      },
    ]);

    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'github', GITHUB_ACCOUNT_ID)
    ).resolves.toBe(0);
    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'github', 'github.com:other')
    ).resolves.toBe(1);
  });

  it('returns 0 for blank inputs and unreadable rows', async () => {
    await seed([{ id: 'bad', settings: 'not-json' }]);

    await expect(countProjectsUsingProviderAccount(fixture.db, 'github', '')).resolves.toBe(0);
    await expect(countProjectsUsingProviderAccount(fixture.db, '', 'x')).resolves.toBe(0);
    await expect(
      countProjectsUsingProviderAccount(fixture.db, 'github', GITHUB_ACCOUNT_ID)
    ).resolves.toBe(0);
  });
});

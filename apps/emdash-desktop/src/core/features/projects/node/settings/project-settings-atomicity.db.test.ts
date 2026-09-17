import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projects } from '@core/services/app-db/node/schema';
import { DesktopProjectSettingsAuthority } from './durable-project-settings';
import { ProjectSettingsRepository } from './project-settings-storage';
import { DbProjectSettingsProvider } from './providers/db-project-settings-provider';

describe('atomic Project settings writes', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let storage: ProjectSettingsRepository;
  let authority: DesktopProjectSettingsAuthority;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values({ id: 'p', name: 'Project' });
    storage = new ProjectSettingsRepository(fixture.db);
    authority = new DesktopProjectSettingsAuthority(storage);
    await storage.insertIfMissing('p', {
      baseProjectSettingsJson: JSON.stringify({ baseRemote: 'origin' }),
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: null,
    });
  });

  afterEach(() => fixture.close());

  async function stored() {
    return JSON.parse((await storage.get('p'))!.baseProjectSettingsJson);
  }

  it('merges simultaneous provider patches against the current row', async () => {
    const results = await Promise.all([
      authority.patch('p', {
        integrationAccounts: { stored: { linear: { kind: 'account', accountId: 'a' } } },
      }),
      authority.patch('p', { integrationAccounts: { stored: { jira: { kind: 'none' } } } }),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await stored()).integrationAccounts).toEqual({
      linear: { kind: 'account', accountId: 'a' },
      jira: { kind: 'none' },
    });
  });

  it.each(['read', 'worktree', 'finalize'] as const)(
    'preserves a newer account patch while %s waits for Host facts',
    async (operation) => {
      const started = deferred();
      const finish = deferred();
      class Provider extends DbProjectSettingsProvider {
        constructor() {
          super('p', '/repo', null, undefined, (root, name) => `${root}/${name}`, {
            storage,
            getRepoFacts: async () => {
              started.resolve();
              await finish.promise;
              return null;
            },
          });
        }
        protected async placementContext() {
          return {
            builtInWorktreeRoot: '/worktrees',
            hostWorktreeRoot: null,
            homeDirectory: '/',
            hostTmux: null,
            appDefaultTmux: false,
          };
        }
        protected async validateWorktreeDirectory(value: string | undefined) {
          return ok(value);
        }
        protected async normalizeStoredWorktreeDirectory(value: string) {
          return ok(value);
        }
      }
      const provider = new Provider();
      const pending =
        operation === 'read'
          ? provider.getStoredIntegrationAccounts()
          : operation === 'worktree'
            ? provider.setWorktreeRoot('/new-worktrees')
            : provider.finalizeLegacyLifecycleSettings();
      await started.promise;
      await authority.patch('p', { integrationAccounts: { stored: { jira: { kind: 'none' } } } });
      finish.resolve();
      await pending;
      expect((await stored()).integrationAccounts).toEqual({ jira: { kind: 'none' } });
      if (operation === 'worktree') expect((await stored()).worktreeRoot).toBe('/new-worktrees');
    }
  );
});

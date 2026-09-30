import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { issuesPluginRegistry } from '@emdash/plugins/issues';
import { ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/project-integration-account-resolver';
import {
  providerAccountContextKey,
  type StoredIntegrationAccounts,
} from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { createIssueProviderRegistry } from './registry';

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  listAccounts: vi.fn(),
  checkConnection: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@core/features/integrations/node/integration-account-store-instance', () => ({
  getIntegrationAccountStore: () => ({ getAccount: mocks.getAccount }),
}));
vi.mock('@core/services/provider-accounts/node/provider-account-service', () => ({
  getProviderAccountService: () => ({ listAccounts: mocks.listAccounts }),
}));
vi.mock('@core/features/integrations/node/integration-connection-service', () => ({
  getIntegrationConnectionService: () => ({ checkConnection: mocks.checkConnection }),
}));

const providers = ['github', 'gitlab', 'forgejo'] as const;
type RepositoryProvider = (typeof providers)[number];

function account(
  providerId: RepositoryProvider,
  host: string,
  id: string,
  isDefault = false
): ProviderAccountSummary {
  return { providerId, accountId: `${host}:${id}`, displayName: id, host, isDefault };
}

function credentials(providerId: string, host: string): IntegrationCredentials {
  return providerId === 'github'
    ? { accessToken: 'token', apiBaseUrl: `https://${host}/api/v3` }
    : { apiToken: 'token', instanceUrl: `https://${host}` };
}

describe('repository issue accounts through the shared registry', () => {
  let accounts: ProviderAccountSummary[];
  let choices: StoredIntegrationAccounts;
  let registry: ReturnType<typeof createIssueProviderRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    accounts = [];
    choices = {};
    mocks.listAccounts.mockImplementation(async (providerId: string) =>
      accounts.filter((candidate) => candidate.providerId === providerId)
    );
    mocks.getAccount.mockImplementation(async (providerId: string, accountId: string) => {
      const found = accounts.find(
        (candidate) => candidate.providerId === providerId && candidate.accountId === accountId
      );
      return found
        ? { ...found, credentials: credentials(providerId, found.host ?? 'code.example') }
        : null;
    });
    mocks.fetch.mockRejectedValue(new Error('Unexpected provider request'));
    vi.stubGlobal('fetch', mocks.fetch);
    registry = createIssueProviderRegistry({
      resolveProjectIntegrationAccount: createProjectIntegrationAccountResolver({
        getProjectRepositoryContext: vi.fn(async () => {
          throw new Error('Unexpected project repository read');
        }),
        getStoredIntegrationAccounts: async () => choices,
        listAccounts: mocks.listAccounts,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function provider(providerId: RepositoryProvider) {
    const result = registry.get(providerId);
    if (!result) throw new Error(`${providerId} issue provider is missing`);
    return result;
  }

  function behavior(providerId: RepositoryProvider) {
    const result = issuesPluginRegistry.get(providerId)?.behavior.issues;
    if (!result) throw new Error(`${providerId} issue behavior is missing`);
    return result;
  }

  it('registers every issue plugin through the shared integration host', () => {
    expect(registry.getAll().map((entry) => entry.type)).toEqual(issuesPluginRegistry.ids());
  });

  it.each(['https://www.github.com/owner/repo.git', 'git@github.com:owner/repo.git'])(
    'normalizes GitHub repository input before host matching and provider execution: %s',
    async (repositoryUrl) => {
      accounts = [account('github', 'github.com', 'default', true)];
      const list = vi.spyOn(behavior('github'), 'listIssues').mockResolvedValue(ok([]));
      expect(await provider('github').listIssues({ repositoryUrl })).toMatchObject({
        success: true,
      });
      expect(mocks.getAccount).toHaveBeenCalledWith('github', 'github.com:default');
      expect(list).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repositoryUrl: 'https://github.com/owner/repo' })
      );
    }
  );

  describe.each(providers)('%s', (providerId) => {
    it.each([undefined, 'project-1'])(
      'rejects hostless repository shorthand before selecting credentials (project=%s)',
      async (projectId) => {
        const selected = account(providerId, 'github.com', 'default', true);
        accounts = [selected];
        choices = { [providerId]: { kind: 'account', accountId: selected.accountId } };
        const list = vi.spyOn(behavior(providerId), 'listIssues');
        const search = vi.spyOn(behavior(providerId), 'searchIssues');
        const options = { projectId, repositoryUrl: 'owner/repo' };

        expect(await provider(providerId).listIssues(options)).toMatchObject({
          success: false,
          error: { type: 'invalid_input' },
        });
        expect(
          await provider(providerId).searchIssues({ ...options, searchTerm: 'bug' })
        ).toMatchObject({ success: false, error: { type: 'invalid_input' } });
        expect(mocks.getAccount).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(search).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    );

    it.each([undefined, 'project-1'])(
      'selects the only repository-host account over another host default (project=%s)',
      async (projectId) => {
        const selected = account(providerId, 'code.example', 'selected');
        accounts = [account(providerId, 'other.example', 'default', true), selected];
        const list = vi
          .spyOn(behavior(providerId), 'listIssues')
          .mockResolvedValue(
            ok([{ identifier: '#1', title: 'Issue', url: 'https://code.example/o/r/issues/1' }])
          );
        const search = vi.spyOn(behavior(providerId), 'searchIssues').mockResolvedValue(ok([]));
        const repositoryUrl = 'https://code.example/o/r';
        const options = {
          projectId,
          repositoryUrl,
          accountContext: providerAccountContextKey(undefined, accounts),
        };
        expect(await provider(providerId).listIssues(options)).toMatchObject({
          success: true,
          data: [{ provider: providerId, accountId: selected.accountId }],
        });
        expect(
          await provider(providerId).searchIssues({ ...options, searchTerm: 'bug' })
        ).toMatchObject({ success: true });
        expect(mocks.getAccount).toHaveBeenCalledWith(providerId, selected.accountId);
        for (const operation of [list, search]) {
          expect(operation).toHaveBeenCalledWith(
            { log: expect.anything(), credentials: credentials(providerId, 'code.example') },
            expect.objectContaining({ repositoryUrl })
          );
        }
      }
    );

    it('prefers the provider default among multiple accounts on the repository host', async () => {
      accounts = [
        account(providerId, 'code.example', 'first'),
        account(providerId, 'code.example', 'default', true),
      ];
      vi.spyOn(behavior(providerId), 'listIssues').mockResolvedValue(ok([]));
      expect(
        await provider(providerId).listIssues({ repositoryUrl: 'https://code.example/o/r' })
      ).toMatchObject({ success: true });
      expect(mocks.getAccount).toHaveBeenCalledWith(providerId, 'code.example:default');
    });

    it('does not choose arbitrarily when multiple host matches have no matching default', async () => {
      accounts = [
        account(providerId, 'other.example', 'default', true),
        account(providerId, 'code.example', 'one'),
        account(providerId, 'code.example', 'two'),
      ];
      expect(
        await provider(providerId).listIssues({ repositoryUrl: 'https://code.example/o/r' })
      ).toMatchObject({ success: false, error: { type: 'auth_required' } });
      expect(mocks.getAccount).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each([undefined, 'project-1'])(
      'rejects a stale account snapshot before reading credentials (project=%s)',
      async (projectId) => {
        const old = account(providerId, 'code.example', 'old', true);
        accounts = [account(providerId, 'code.example', 'new', true)];
        const result = await provider(providerId).listIssues({
          projectId,
          repositoryUrl: 'https://code.example/o/r',
          accountContext: providerAccountContextKey(undefined, [old]),
        });
        expect(result).toMatchObject({
          success: false,
          error: { type: 'account_context_changed' },
        });
        expect(mocks.getAccount).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    );

    it('keeps the snapshot account if the default changes during credential lookup', async () => {
      const first = account(providerId, 'code.example', 'first', true);
      const second = account(providerId, 'code.example', 'second');
      accounts = [first, second];
      const list = vi.spyOn(behavior(providerId), 'listIssues').mockResolvedValue(ok([]));
      mocks.getAccount.mockImplementationOnce(async (_provider: string, accountId: string) => {
        accounts = [
          { ...first, isDefault: false },
          { ...second, isDefault: true },
        ];
        return { accountId, credentials: credentials(providerId, 'code.example') };
      });
      expect(
        await provider(providerId).listIssues({
          repositoryUrl: 'https://code.example/o/r',
          accountContext: providerAccountContextKey(undefined, accounts),
        })
      ).toMatchObject({ success: true });
      expect(mocks.getAccount).toHaveBeenCalledExactlyOnceWith(providerId, first.accountId);
      expect(list).toHaveBeenCalledOnce();
    });

    it.each([
      { name: 'disabled', choice: { kind: 'none' as const }, provenance: 'set' },
      {
        name: 'missing pin',
        choice: { kind: 'account' as const, accountId: 'removed' },
        provenance: 'unresolvable',
      },
      {
        name: 'other-host pin',
        choice: { kind: 'account' as const, accountId: 'other.example:pinned' },
        provenance: 'unresolvable',
      },
    ])('fails closed for $name before credential access', async ({ choice, provenance }) => {
      accounts = [
        account(providerId, 'code.example', 'default', true),
        account(providerId, 'other.example', 'pinned'),
      ];
      choices = { [providerId]: choice };
      const result = await provider(providerId).listIssues({
        projectId: 'project-1',
        repositoryUrl: 'https://code.example/o/r',
      });
      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'account_unavailable',
          provenance: { kind: provenance },
          accountsConnected: true,
        },
      });
      expect(mocks.getAccount).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('reports a connect state when the project has no accounts', async () => {
      expect(
        await provider(providerId).listIssues({
          projectId: 'project-1',
          repositoryUrl: 'https://code.example/o/r',
        })
      ).toMatchObject({
        success: false,
        error: {
          type: 'account_unavailable',
          provenance: { kind: 'inferred' },
          accountsConnected: false,
        },
      });
      expect(mocks.getAccount).not.toHaveBeenCalled();
    });

    it('does not send credentials to an incompatible resource even without legacy host metadata', async () => {
      accounts = [{ ...account(providerId, 'code.example', 'legacy', true), host: undefined }];
      mocks.getAccount.mockResolvedValue({
        accountId: accounts[0]!.accountId,
        credentials: credentials(providerId, 'other.example'),
      });
      expect(
        await provider(providerId).listIssues({ repositoryUrl: 'https://code.example/o/r' })
      ).toMatchObject({ success: false, error: { type: 'unsupported_host' } });
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('does not fall back if credentials disappear after account selection', async () => {
      accounts = [account(providerId, 'code.example', 'missing', true)];
      mocks.getAccount.mockResolvedValue(null);
      expect(
        await provider(providerId).listIssues({ repositoryUrl: 'https://code.example/o/r' })
      ).toMatchObject({ success: false, error: { type: 'auth_required' } });
      expect(mocks.getAccount).toHaveBeenCalledExactlyOnceWith(providerId, 'code.example:missing');
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('accepts the remote fallback and resolves its repository host', async () => {
      accounts = [account(providerId, 'code.example', 'default', true)];
      const list = vi.spyOn(behavior(providerId), 'listIssues').mockResolvedValue(ok([]));
      const remote = 'git@code.example:o/r.git';
      expect(await provider(providerId).listIssues({ remote })).toMatchObject({ success: true });
      expect(list).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repositoryUrl: 'https://code.example/o/r' })
      );
    });

    it('uses the shared connection verification result', async () => {
      const status = { connected: false, error: 'Bad credentials' };
      mocks.checkConnection.mockResolvedValue(status);
      expect(await provider(providerId).checkConnection()).toBe(status);
      expect(mocks.checkConnection).toHaveBeenCalledWith(providerId, {
        requiresRepositoryUrl: true,
        supportsIssueContext: false,
      });
    });
  });
});

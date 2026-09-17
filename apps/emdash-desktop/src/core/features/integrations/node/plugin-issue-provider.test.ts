import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCredentials, mockGetAccount, mockCheckConnection, mockListAccounts } = vi.hoisted(
  () => ({
    mockGetCredentials: vi.fn(),
    mockGetAccount: vi.fn(),
    mockCheckConnection: vi.fn(),
    mockListAccounts: vi.fn(),
  })
);

vi.mock('./integration-account-store-instance', () => ({
  getIntegrationAccountStore: () => ({
    getAccount: mockGetAccount,
  }),
}));

vi.mock('@core/services/provider-accounts/node/provider-account-service', () => ({
  getProviderAccountService: () => ({ listAccounts: mockListAccounts }),
}));

vi.mock('./integration-connection-service', () => ({
  getIntegrationConnectionService: () => ({ checkConnection: mockCheckConnection }),
}));

vi.mock('@emdash/shared/logger', () => {
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return { log };
});

import { createPluginIssueProvider } from '@core/features/integrations/api/node/plugin-issue-provider';
import type { PluginIssueProviderDependencies } from '@core/features/integrations/api/node/plugin-issue-provider';

/** Default-account resolution for tests without a project context. */
const testDependencies: PluginIssueProviderDependencies = {
  resolveProjectIntegrationAccount: vi.fn(async () => ({
    value: null,
    provenance: { kind: 'inferred' as const, from: 'default account' },
    accounts: [],
    contextKey: '',
  })),
};

function makePlugin(overrides: {
  integrationId?: string;
  requiredInputs?: 'repositoryUrl'[];
  listIssues?: ReturnType<typeof vi.fn>;
  searchIssues?: ReturnType<typeof vi.fn>;
  getIssue?: ReturnType<typeof vi.fn>;
}): IssuesPluginProvider {
  return {
    metadata: { integrationId: overrides.integrationId ?? 'linear' },
    capabilities: { issues: { requiredInputs: overrides.requiredInputs ?? [] } },
    assets: {},
    validate: () => [],
    behavior: {
      issues: {
        listIssues: overrides.listIssues ?? vi.fn(async () => ok([])),
        searchIssues: overrides.searchIssues ?? vi.fn(async () => ok([])),
        ...(overrides.getIssue ? { getIssue: overrides.getIssue } : {}),
      },
    },
  } as unknown as IssuesPluginProvider;
}

describe('createPluginIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAccounts.mockResolvedValue([
      { providerId: 'linear', accountId: 'default', displayName: 'Default', isDefault: true },
    ]);
    mockGetAccount.mockImplementation(async (_provider: string, accountId?: string) => {
      const credentials = await mockGetCredentials(_provider, accountId);
      return credentials ? { accountId: accountId ?? 'default', credentials } : null;
    });
  });

  it('retains the source account on issues returned by a default-account lookup', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'workspace-a' });
    const provider = createPluginIssueProvider(
      makePlugin({ listIssues: vi.fn(async () => ok([{ identifier: 'ENG-1', title: 'A' }])) }),
      testDependencies
    );
    const result = await provider.listIssues({});
    expect(result).toMatchObject({ success: true, data: [{ accountId: 'default' }] });
  });

  it.each([true, false])(
    'refreshes the source after switching projects accounts (new account exists=%s)',
    async (exists) => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'workspace-a' });
      const getIssue = vi.fn(async () =>
        ok({ identifier: 'ENG-1', title: 'Original', url: 'https://linear.app/a/issue/ENG-1' })
      );
      const provider = createPluginIssueProvider(makePlugin({ getIssue }), {
        resolveProjectIntegrationAccount: vi.fn(async () => ({
          value: exists
            ? {
                providerId: 'linear',
                accountId: 'workspace-b',
                displayName: 'B',
                isDefault: true,
              }
            : null,
          provenance: exists ? { kind: 'set' as const } : { kind: 'unresolvable' as const },
          accounts: [],
          contextKey: '',
        })),
      });
      const result = await provider.getIssueContext?.({
        projectId: 'p1',
        identifier: 'ENG-1',
        accountId: 'workspace-a',
        issueUrl: 'https://linear.app/a/issue/ENG-1',
      });
      expect(mockGetCredentials).toHaveBeenCalledWith('linear', 'workspace-a');
      expect(getIssue).toHaveBeenCalledWith(
        { log: expect.anything(), credentials: { apiKey: 'workspace-a' } },
        { identifier: 'ENG-1', repositoryUrl: undefined }
      );
      expect(result).toMatchObject({
        success: true,
        data: { accountId: 'workspace-a', title: 'Original' },
      });
    }
  );

  it('does not fall back when the original linked account was removed', async () => {
    mockGetCredentials.mockResolvedValue(null);
    const getIssue = vi.fn();
    const provider = createPluginIssueProvider(makePlugin({ getIssue }), testDependencies);
    const result = await provider.getIssueContext?.({ identifier: 'ENG-1', accountId: 'removed' });
    expect(result?.success).toBe(false);
    expect(mockGetCredentials).toHaveBeenCalledWith('linear', 'removed');
    expect(getIssue).not.toHaveBeenCalled();
  });

  it('rejects a legacy issue refreshed from a different workspace with the same shorthand', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'workspace-b' });
    const provider = createPluginIssueProvider(
      makePlugin({
        getIssue: vi.fn(async () =>
          ok({
            identifier: 'ENG-1',
            title: 'Wrong workspace',
            url: 'https://linear.app/b/issue/ENG-1',
          })
        ),
      }),
      testDependencies
    );
    const result = await provider.getIssueContext?.({
      identifier: 'ENG-1',
      issueUrl: 'https://linear.app/a/issue/ENG-1',
    });
    expect(result).toMatchObject({ success: false, error: { type: 'not_found_or_no_access' } });
  });

  it('refreshes a renamed Trello card but rejects another accessible card', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'trello', apiToken: 'token' });
    const getIssue = vi.fn(async () =>
      ok({ identifier: 'abc123', title: 'New name', url: 'https://trello.com/c/abc123/1-new-name' })
    );
    const provider = createPluginIssueProvider(
      makePlugin({ integrationId: 'trello', getIssue }),
      testDependencies
    );
    const source = {
      identifier: 'abc123',
      accountId: 'member',
      issueUrl: 'https://trello.com/c/abc123/1-old-name',
    };
    expect(await provider.getIssueContext?.(source)).toMatchObject({
      success: true,
      data: { title: 'New name', accountId: 'member' },
    });
    getIssue.mockResolvedValue(
      ok({
        identifier: 'xyz456',
        title: 'Other card',
        url: 'https://trello.com/c/xyz456/1-old-name',
      })
    );
    expect(await provider.getIssueContext?.(source)).toMatchObject({
      success: false,
      error: { type: 'not_found_or_no_access' },
    });
  });

  it('honors explicit project suppression even for an issue with a source account', async () => {
    const getIssue = vi.fn();
    const provider = createPluginIssueProvider(makePlugin({ getIssue }), {
      resolveProjectIntegrationAccount: vi.fn(async () => ({
        value: null,
        provenance: { kind: 'set' as const },
        accounts: [],
        contextKey: '',
      })),
    });
    const result = await provider.getIssueContext?.({
      identifier: 'ENG-1',
      projectId: 'p1',
      accountId: 'workspace-a',
    });
    expect(result).toMatchObject({ success: false, error: { type: 'account_unavailable' } });
    expect(getIssue).not.toHaveBeenCalled();
  });

  it('derives capabilities from requiredInputs', () => {
    const provider = createPluginIssueProvider(
      makePlugin({ requiredInputs: ['repositoryUrl'] }),
      testDependencies
    );
    expect(provider.capabilities).toEqual({
      requiresRepositoryUrl: true,
      supportsIssueContext: false,
    });
  });

  it('returns auth_required when the integration is not connected', async () => {
    mockGetCredentials.mockResolvedValue(null);
    const provider = createPluginIssueProvider(makePlugin({}), testDependencies);

    await expect(provider.listIssues({})).resolves.toEqual({
      success: false,
      error: { type: 'auth_required', message: 'linear is not connected.' },
    });
  });

  it('resolves the project-pinned account and fetches its credentials', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'pinned' });
    const listIssues = vi.fn(async () => ok([]));
    const resolveProjectIntegrationAccount = vi.fn(async () => ({
      value: {
        providerId: 'linear',
        accountId: 'linear:acct-2',
        displayName: 'Second workspace',
        isDefault: false,
      },
      provenance: { kind: 'set' as const },
      accounts: [],
      contextKey: '',
    }));
    const provider = createPluginIssueProvider(makePlugin({ listIssues }), {
      resolveProjectIntegrationAccount,
    });

    const result = await provider.listIssues({ projectId: 'p1' });
    expect(result.success).toBe(true);
    expect(resolveProjectIntegrationAccount).toHaveBeenCalledWith('p1', 'linear', undefined);
    expect(mockGetCredentials).toHaveBeenCalledWith('linear', 'linear:acct-2');
  });

  it('fails closed when the integration is explicitly disabled for the project', async () => {
    const provider = createPluginIssueProvider(makePlugin({}), {
      resolveProjectIntegrationAccount: vi.fn(async () => ({
        value: null,
        provenance: { kind: 'set' as const },
        accounts: [],
        contextKey: '',
      })),
    });

    const result = await provider.listIssues({ projectId: 'p1' });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'account_unavailable', provenance: { kind: 'set' } },
    });
    expect(mockGetCredentials).not.toHaveBeenCalled();
  });

  it('fails closed on a dangling project account pin', async () => {
    const provider = createPluginIssueProvider(makePlugin({}), {
      resolveProjectIntegrationAccount: vi.fn(async () => ({
        value: null,
        provenance: { kind: 'unresolvable' as const },
        accounts: [],
        contextKey: '',
      })),
    });

    const result = await provider.listIssues({ projectId: 'p1' });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'account_unavailable', provenance: { kind: 'unresolvable' } },
    });
    expect(mockGetCredentials).not.toHaveBeenCalled();
  });

  it('gates repository-scoped plugins on a repository URL', async () => {
    mockGetCredentials.mockResolvedValue({ apiToken: 't' });
    const listIssues = vi.fn(async () => ok([]));
    const provider = createPluginIssueProvider(
      makePlugin({ requiredInputs: ['repositoryUrl'], listIssues }),
      testDependencies
    );

    await expect(provider.listIssues({})).resolves.toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'Repository URL including its host is required.' },
    });
    expect(listIssues).not.toHaveBeenCalled();
  });

  it('invokes the plugin with host credentials and maps issues', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const listIssues = vi.fn(async () =>
      ok([{ identifier: 'ENG-1', title: 'Fix it', url: 'https://linear.app/eng-1' }])
    );
    const provider = createPluginIssueProvider(makePlugin({ listIssues }), testDependencies);

    const result = await provider.listIssues({ limit: 10 });
    expect(listIssues).toHaveBeenCalledWith(
      { log: expect.anything(), credentials: { apiKey: 'k' } },
      expect.objectContaining({ limit: 10 })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toMatchObject({
        provider: 'linear',
        identifier: 'ENG-1',
        title: 'Fix it',
      });
    }
  });

  it('passes plugin errors through verbatim on search', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const searchIssues = vi.fn(async () => err({ type: 'auth_failed' as const, message: '401' }));
    const provider = createPluginIssueProvider(makePlugin({ searchIssues }), testDependencies);

    await expect(provider.searchIssues({ searchTerm: 'bug' })).resolves.toEqual({
      success: false,
      error: { type: 'auth_failed', message: '401' },
    });
  });

  it('short-circuits empty search terms', async () => {
    const searchIssues = vi.fn();
    const provider = createPluginIssueProvider(makePlugin({ searchIssues }), testDependencies);

    await expect(provider.searchIssues({ searchTerm: '   ' })).resolves.toEqual({
      success: true,
      data: [],
    });
    expect(searchIssues).not.toHaveBeenCalled();
    expect(mockGetCredentials).not.toHaveBeenCalled();
  });

  it('exposes getIssueContext only when the plugin implements getIssue', async () => {
    const withoutGet = createPluginIssueProvider(makePlugin({}), testDependencies);
    expect(withoutGet.getIssueContext).toBeUndefined();

    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const getIssue = vi.fn(async () =>
      ok({ identifier: 'ENG-1', title: 'Fix it', url: 'https://linear.app/eng-1' })
    );
    const withGet = createPluginIssueProvider(makePlugin({ getIssue }), testDependencies);
    const result = await withGet.getIssueContext?.({ identifier: 'ENG-1' });
    expect(result).toMatchObject({ success: true });
  });
});

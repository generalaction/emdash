import type {
  IssuesPluginProvider,
  IssueListResult as PluginIssueListResult,
} from '@emdash/plugins/issues';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { JSDOM } from 'jsdom';
import { observable, runInAction } from 'mobx';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/primitives/issue-providers/api';
import type { StoredIntegrationAccounts } from '@core/primitives/project-settings/api';
import {
  ProviderAccountService,
  setProviderAccountService,
} from '@core/services/provider-accounts/node/provider-account-service';
// This integration test runs the renderer and main-process adapters in one Node process.
import type {} from '../../../../renderer/globals';
import { useIssues } from '../api/browser/use-issues';
import { invalidateProviderAccountState } from '../api/browser/use-provider-accounts';
import { createPluginIssueProvider } from '../api/node/plugin-issue-provider';
import { createProjectIntegrationAccountResolver } from '../api/node/project-integration-account-resolver';
import { IntegrationAccountStore } from '../node/integration-account-store';
import { setIntegrationAccountStore } from '../node/integration-account-store-instance';

// Only the Wire transport is replaced. Inventory, storage, resolution, credentials,
// server policy and React Query all run their production implementations.
const wire = vi.hoisted(() => ({
  inventory: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('../api/browser/client', () => ({
  getIntegrationsClient: async () => ({ listAccounts: wire.inventory }),
}));
vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({ listIssues: wire.list, searchIssues: wire.search }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: wire.settings,
}));

describe('account-bound issue cache across browser and server', () => {
  let fixture: RegistryFixture;
  let accounts: ProviderAccountService;
  let credentials: IntegrationAccountStore;
  let queryClient: QueryClient;
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  let serverChoices: StoredIntegrationAccounts;
  let browserChoices: { stored: StoredIntegrationAccounts };
  let getIssues: Mock<
    (host: { credentials: { apiKey: string } }) => Promise<PluginIssueListResult>
  >;

  beforeEach(async () => {
    vi.useFakeTimers();
    fixture = await openRegistryFixture();
    accounts = new ProviderAccountService(fixture.registry);
    credentials = new IntegrationAccountStore(fixture.registry, async () => {});
    setProviderAccountService(accounts);
    setIntegrationAccountStore(credentials);
    await credentials.upsertAccount('linear', { accountId: 'a', credentials: { apiKey: 'a-v1' } });
    await credentials.upsertAccount('linear', { accountId: 'b', credentials: { apiKey: 'b-v1' } });
    serverChoices = {};
    browserChoices = observable({ stored: {} as StoredIntegrationAccounts });
    wire.settings.mockReturnValue({
      durableDomains: { integrationAccounts: browserChoices },
      pageData: {
        error: null,
        invalidate: () =>
          runInAction(() => {
            browserChoices.stored = serverChoices;
          }),
      },
    });
    const resolver = createProjectIntegrationAccountResolver({
      getProjectRepositoryContext: vi.fn(async () => {
        throw new Error('Unexpected project repository read');
      }),
      getStoredIntegrationAccounts: async () => serverChoices,
      listAccounts: (id) => accounts.listAccounts(id),
    });
    getIssues = vi.fn(async (host: { credentials: { apiKey: string } }) =>
      ok([
        {
          identifier: 'ENG-1',
          title: host.credentials.apiKey,
          url: 'https://linear.app/acme/issue/ENG-1',
        },
      ])
    );
    const plugin = {
      metadata: { integrationId: 'linear' },
      capabilities: { issues: { requiredInputs: [] } },
      assets: {},
      validate: () => [],
      behavior: { issues: { listIssues: getIssues, searchIssues: getIssues } },
    } as unknown as IssuesPluginProvider;
    const provider = createPluginIssueProvider(plugin, {
      resolveProjectIntegrationAccount: resolver,
    });
    wire.inventory.mockImplementation(async () => ({
      linear: await accounts.listAccounts('linear'),
    }));
    wire.list.mockImplementation(({ options }: { options: IssueQueryOpts }) =>
      provider.listIssues(options)
    );
    wire.search.mockImplementation(({ options }: { options: IssueSearchOpts }) =>
      provider.searchIssues(options)
    );
    dom = new JSDOM('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    fixture.close();
    dom.window.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function Probe() {
    const result = useIssues('linear', { projectId: 'p' });
    return React.createElement(
      'button',
      { onClick: () => result.setSearchTerm('bug') },
      result.issues.map((issue) => issue.title).join(',')
    );
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
  }

  async function mount() {
    await act(async () =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe)
        )
      )
    );
    await flush();
    await flush();
  }

  function assertCacheOwnership() {
    for (const query of queryClient.getQueryCache().getAll()) {
      const kind = query.queryKey[0];
      if (kind !== 'issues:initial' && kind !== 'issues:search') continue;
      const key = JSON.parse(query.queryKey.at(-1) as string);
      const context = kind === 'issues:search' ? JSON.parse(key.at(-1)) : key;
      const expected =
        context.choice?.accountId ??
        context.accounts.find((account: [string, boolean]) => account[1])?.[0];
      const result = query.state.data as IssueListResult | undefined;
      if (result?.success) for (const issue of result.data) expect(issue.accountId).toBe(expected);
    }
  }

  it('never caches B under A during list/search refetches, late responses or A→B→A', async () => {
    await mount();
    expect(container.textContent).toBe('a-v1');
    await act(async () => container.querySelector('button')!.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305);
    });
    await flush();
    const late = deferred<PluginIssueListResult>();
    getIssues.mockImplementationOnce(() => late.promise);
    void queryClient.refetchQueries({ queryKey: ['issues:search'] });
    await flush();
    await act(async () => {
      await accounts.setDefaultAccount('linear', 'b');
      await invalidateProviderAccountState(queryClient);
    });
    await flush();
    await flush();
    expect(container.textContent).toBe('b-v1');
    late.resolve(
      ok([{ identifier: 'ENG-1', title: 'late A', url: 'https://linear.app/acme/issue/ENG-1' }])
    );
    await flush();
    // Deliberately refetch obsolete observers: the server must reject the old
    // context instead of allowing a successful B result into their A key.
    await act(async () => {
      await queryClient.refetchQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith('issues:'),
        type: 'all',
      });
    });
    await flush();
    assertCacheOwnership();
    expect(container.textContent).toBe('b-v1');
    await act(async () => {
      await accounts.setDefaultAccount('linear', 'a');
      await invalidateProviderAccountState(queryClient);
    });
    await flush();
    await flush();
    expect(container.textContent).toBe('a-v1');
    assertCacheOwnership();
    const replies = await Promise.all(
      [...wire.list.mock.results, ...wire.search.mock.results].map((r) => r.value)
    );
    expect(replies.some((r) => !r.success && r.error.type === 'account_context_changed')).toBe(
      true
    );
  });

  it('refreshes a reconnect under the same key and discards the old in-flight response', async () => {
    await mount();
    const late = deferred<PluginIssueListResult>();
    getIssues.mockImplementationOnce(() => late.promise);
    void queryClient.refetchQueries({ queryKey: ['issues:initial'] });
    await flush();
    await act(async () => {
      await credentials.upsertAccount('linear', {
        accountId: 'a',
        credentials: { apiKey: 'a-v2' },
      });
      await invalidateProviderAccountState(queryClient);
    });
    await flush();
    late.resolve(
      ok([{ identifier: 'ENG-1', title: 'a-v1', url: 'https://linear.app/acme/issue/ENG-1' }])
    );
    await flush();
    expect(container.textContent).toBe('a-v2');
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['issues:initial'] })
        .filter((query) => query.state.status === 'success')
    ).toHaveLength(1);
    assertCacheOwnership();
  });

  it.each([{ kind: 'none' }, { kind: 'account', accountId: 'removed' }] as const)(
    'keeps server-side disable and missing-account rules after a stale choice ($kind)',
    async (choice) => {
      await mount();
      const requests = getIssues.mock.calls.length;
      serverChoices = { linear: choice };
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ['issues:initial'] });
      });
      await flush();
      await flush();
      expect(container.textContent).toBe('');
      expect(getIssues).toHaveBeenCalledTimes(requests);
      const results = await Promise.all(wire.list.mock.results.map((r) => r.value));
      expect(results.some((r) => !r.success && r.error.type === 'account_unavailable')).toBe(true);
    }
  );

  it('rejects stale project choices and reloads the choice before fetching the new account', async () => {
    await mount();
    serverChoices = { linear: { kind: 'account', accountId: 'b' } };
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['issues:initial'] });
    });
    await flush();
    await flush();
    expect(container.textContent).toBe('b-v1');
    assertCacheOwnership();
  });
});

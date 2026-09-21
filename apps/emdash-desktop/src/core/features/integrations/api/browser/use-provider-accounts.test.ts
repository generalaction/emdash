import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { invalidateProviderAccountState, useAccounts } from './use-provider-accounts';

const mocks = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('./client', () => ({
  getIntegrationsClient: async () => ({ listAccounts: mocks.listAccounts }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useAccounts', () => {
  it('filters providers and refines summaries without fetching a separate inventory', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const account: ProviderAccountSummary = {
      providerId: 'github',
      accountId: 'github.com:1',
      displayName: 'Alice',
      login: 'alice',
      isDefault: true,
    };
    mocks.listAccounts.mockResolvedValue({
      github: [account, { ...account, accountId: 'github.com:2', login: undefined }],
      jira: [{ ...account, providerId: 'jira', accountId: 'jira:1' }],
    });
    const hasLogin = (
      summary: ProviderAccountSummary
    ): summary is ProviderAccountSummary & { login: string } => summary.login !== undefined;
    function Probe({ providerId }: { providerId: string }) {
      const inventory = useAccounts();
      const provider = useAccounts(providerId);
      const refined = useAccounts(providerId, hasLogin);
      if (provider.data?.length) {
        expect(provider.data).toEqual(inventory.data?.[providerId]);
      }
      return React.createElement(
        'span',
        {},
        `${provider.data?.length ?? 'loading'}:${refined.data?.length ?? 'loading'}`
      );
    }
    async function render(providerId: string) {
      await act(async () => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(Probe, { providerId })
          )
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    try {
      await render('github');
      expect(container.textContent).toBe('2:1');
      await render('jira');
      expect(container.textContent).toBe('1:1');
      await render('linear');
      expect(container.textContent).toBe('0:0');
      expect(mocks.listAccounts).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      dom.window.close();
    }
  });
});

function isInvalidated(queryClient: QueryClient, queryKey: readonly unknown[]): boolean {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) throw new Error(`query ${JSON.stringify(queryKey)} not found`);
  return query.state.isInvalidated;
}

describe('invalidateProviderAccountState', () => {
  it('invalidates the shared inventory and dependent queries for every provider', async () => {
    const queryClient = new QueryClient();
    const accountDependent = [
      ['integrations:accounts'],
      ['issues:connection-status'],
      // Issue queries carry the account-unavailable reporting state (§7), so
      // the issue picker's connect empty state must re-resolve after connect.
      ['issues:initial', 'github', 'project-1', '', 'https://github.com/o/r', 50],
      ['issues:search', 'github', 'project-1', '', 'https://github.com/o/r', 'bug', 20],
      ['issues:initial', 'linear', 'project-1', '', '', 50],
    ] as const;
    for (const queryKey of accountDependent) {
      queryClient.setQueryData(queryKey, {});
    }
    queryClient.setQueryData(['unrelated'], {});

    await invalidateProviderAccountState(queryClient);

    for (const queryKey of accountDependent) {
      expect(isInvalidated(queryClient, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
    expect(isInvalidated(queryClient, ['unrelated'])).toBe(false);
  });
});

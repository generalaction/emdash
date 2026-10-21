import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAccounts } from '@core/features/integrations/api/browser/use-provider-accounts';
import { type GitHubAccountSummary } from '@core/primitives/github/api';
import { useImportGitHubCliAccounts } from './use-github-auth';

const mocks = vi.hoisted(() => ({ listAccounts: vi.fn(), importCliAccounts: vi.fn() }));
vi.mock('@core/features/integrations/api/browser/client', () => ({
  getIntegrationsClient: async () => ({ listAccounts: mocks.listAccounts }),
}));
vi.mock('./client', () => ({
  getGithubClient: async () => ({ importCliAccounts: mocks.importCliAccounts }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GitHub authentication account refresh', () => {
  it('shares one inventory with generic views and refreshes both after CLI import', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const account: GitHubAccountSummary = {
      providerId: 'github',
      displayName: '@alice',
      accountId: 'github.com:1',
      host: 'github.com',
      login: 'alice',
      avatarUrl: '',
      credentialSource: 'cli',
      isDefault: true,
    };
    let accounts = [account];
    mocks.listAccounts.mockImplementation(async () => ({ github: accounts }));
    mocks.importCliAccounts.mockImplementation(async () => {
      accounts = [
        ...accounts,
        {
          ...account,
          accountId: 'github.com:2',
          login: 'bob',
          isDefault: false,
        },
      ];
      return { success: true, importedAccountIds: ['github.com:2'] };
    });
    let importAccounts: (() => Promise<unknown>) | undefined;
    function Probe() {
      const inventory = useAccounts();
      const github = useAccounts('github');
      if (github.data?.length) expect(github.data[0]).toBe(inventory.data?.github?.[0]);
      const mutation = useImportGitHubCliAccounts();
      importAccounts = () => mutation.mutateAsync();
      return React.createElement(
        'span',
        {},
        `${inventory.data?.github?.length ?? 0}:${github.data?.length ?? 0}`
      );
    }
    try {
      await act(async () => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(Probe)
          )
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(container.textContent).toBe('1:1');
      expect(mocks.listAccounts).toHaveBeenCalledTimes(1);
      await act(async () => {
        await importAccounts?.();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(container.textContent).toBe('2:2');
      expect(mocks.listAccounts).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      dom.window.close();
    }
  });
});

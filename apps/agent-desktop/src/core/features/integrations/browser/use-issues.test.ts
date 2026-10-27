import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIssues } from '@core/features/integrations/api/browser/use-issues';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listIssues: vi.fn(),
  searchIssues: vi.fn(),
  listAccounts: vi.fn(),
  getProjectSettingsStore: vi.fn(),
}));

vi.mock('@core/features/integrations/api/browser/client', () => ({
  getIntegrationsClient: async () => ({ listAccounts: mocks.listAccounts }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: mocks.getProjectSettingsStore,
}));

vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({
    listIssues: mocks.listIssues,
    searchIssues: mocks.searchIssues,
  }),
}));

function Probe({ repositoryUrl = 'https://github.com/acme/repo' }: { repositoryUrl?: string }) {
  const result = useIssues('github', {
    projectId: 'project-1',
    repositoryUrl,
  });

  return React.createElement(
    'div',
    {},
    React.createElement('button', {
      'data-testid': 'search',
      onClick: () => result.setSearchTerm('bug'),
    }),
    React.createElement('span', { 'data-testid': 'error' }, result.error ?? ''),
    React.createElement('span', { 'data-testid': 'count' }, String(result.issues.length))
  );
}

describe('useIssues', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listAccounts.mockResolvedValue({
      github: [
        { accountId: 'a', isDefault: true },
        { accountId: 'b', isDefault: false },
      ],
    });
    mocks.getProjectSettingsStore.mockReturnValue({
      durableDomains: {
        integrationAccounts: { stored: { github: { kind: 'account', accountId: 'a' } } },
      },
      pageData: { error: null },
    });
    mocks.listIssues.mockResolvedValue({ success: true, data: [] });
    mocks.searchIssues.mockResolvedValue({
      success: false,
      error: {
        type: 'not_found_or_no_access',
        message:
          'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      },
    });

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('surfaces search errors instead of converting them to an empty result', async () => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe)
        )
      );
    });

    const search = container.querySelector('[data-testid="search"]');
    expect(search).not.toBeNull();

    await act(async () => {
      search!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
      );
    });
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
  });

  async function renderProbe(props: { repositoryUrl?: string } = {}) {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe, props)
        )
      );
      await vi.advanceTimersByTimeAsync(1);
    });
  }

  it('waits for the project account choice before fetching issues', async () => {
    mocks.getProjectSettingsStore.mockReturnValue({
      durableDomains: null,
      pageData: { error: null },
    });
    await renderProbe();
    expect(mocks.listIssues).not.toHaveBeenCalled();
    mocks.getProjectSettingsStore.mockReturnValue({
      durableDomains: { integrationAccounts: { stored: {} } },
      pageData: { error: null },
    });
    await renderProbe();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.listIssues).toHaveBeenCalledTimes(1);
  });

  it('fetches a new project account immediately without showing the old account cache', async () => {
    mocks.listIssues.mockResolvedValueOnce({ success: true, data: [{ identifier: 'A-1' }] });
    await renderProbe();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('1');
    mocks.listIssues.mockReturnValue(new Promise(() => {}));
    mocks.getProjectSettingsStore.mockReturnValue({
      durableDomains: {
        integrationAccounts: { stored: { github: { kind: 'account', accountId: 'b' } } },
      },
      pageData: { error: null },
    });
    await renderProbe();
    expect(mocks.listIssues).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
  });

  it('does not retain another account search results as placeholder data', async () => {
    mocks.searchIssues.mockResolvedValueOnce({ success: true, data: [{ identifier: 'A-1' }] });
    await renderProbe();
    await act(async () => {
      container
        .querySelector('[data-testid="search"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(301);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('1');
    mocks.searchIssues.mockReturnValue(new Promise(() => {}));
    mocks.getProjectSettingsStore.mockReturnValue({
      durableDomains: {
        integrationAccounts: { stored: { github: { kind: 'account', accountId: 'b' } } },
      },
      pageData: { error: null },
    });
    await renderProbe();
    expect(mocks.searchIssues).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
  });

  it('does not retain another repository search results under the same account', async () => {
    mocks.searchIssues.mockResolvedValueOnce({ success: true, data: [{ identifier: 'A-1' }] });
    await renderProbe();
    await act(async () => {
      container
        .querySelector('[data-testid="search"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('1');
    mocks.searchIssues.mockReturnValue(new Promise(() => {}));
    await renderProbe({ repositoryUrl: 'https://github.com/acme/other' });
    expect(mocks.searchIssues).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
  });
});

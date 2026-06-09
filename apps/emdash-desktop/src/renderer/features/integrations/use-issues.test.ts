import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIssues } from './use-issues';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listIssues: vi.fn(),
  searchIssues: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    issues: {
      listIssues: mocks.listIssues,
      searchIssues: mocks.searchIssues,
    },
  },
}));

function Probe() {
  const result = useIssues('github', {
    projectId: 'project-1',
    repositoryUrl: 'https://github.com/acme/repo',
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
    mocks.listIssues.mockResolvedValue({ success: true, issues: [] });
    mocks.searchIssues.mockResolvedValue({
      success: false,
      error:
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
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
});

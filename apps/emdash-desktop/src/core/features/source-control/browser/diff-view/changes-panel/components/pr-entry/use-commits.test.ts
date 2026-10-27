import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitsQueryKey, useCommits } from './use-commits';

const mocks = vi.hoisted(() => ({
  getLog: vi.fn(),
}));

vi.mock('@core/features/source-control/api/browser/client', () => ({
  checkoutSelector: (workspaceId: string) => ({ workspaceId }),
  getSourceControlClient: async () => ({ checkout: { getLog: mocks.getLog } }),
}));

describe('useCommits', () => {
  let dom: JSDOM;
  let root: Root;
  let host: HTMLDivElement;
  let queryClient: QueryClient;
  let resolveReplacement: (() => void) | undefined;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    host = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(host);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    mocks.getLog
      .mockResolvedValueOnce({ success: true, data: { commits: [], totalCount: 2 } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReplacement = () =>
              resolve({ success: true, data: { commits: [], totalCount: 3 } });
          })
      );
  });

  afterEach(async () => {
    await queryClient.cancelQueries();
    await act(async () => root.unmount());
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('keys commit data only by its immutable OID range', () => {
    const key = commitsQueryKey('project-1', 'workspace-1', 'branch', 'base', 'head');

    expect(key).toEqual(['project-1', 'workspace-1', 'commits', 'branch', 'base', 'head']);
  });

  it('retains the branch commit presentation while a changed OID range loads', async () => {
    function Probe({ headRefOid }: { headRefOid: string }) {
      const result = useCommits('project-1', 'workspace-1', {
        source: 'branch',
        baseRefOid: 'base',
        headRefOid,
      });
      const aheadCount = result.data?.pages[0]?.aheadCount;
      const label = aheadCount !== undefined && aheadCount > 0 ? 'Branch Commits' : 'Pull Requests';
      return React.createElement('span', null, `${label}:${aheadCount ?? 0}`);
    }

    const render = (headRefOid: string) =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe, { headRefOid })
        )
      );

    await act(async () => render('head-1'));
    await vi.waitFor(() => expect(host.textContent).toBe('Branch Commits:2'));

    await act(async () => render('head-2'));
    expect(host.textContent).toBe('Branch Commits:2');

    await act(async () => resolveReplacement?.());
    await vi.waitFor(() => expect(host.textContent).toBe('Branch Commits:3'));
  });
});

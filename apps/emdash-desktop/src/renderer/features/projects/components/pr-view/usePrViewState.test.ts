import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrViewState } from './usePrViewState';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  dataUpdatedAt: 0,
  forceFullSyncPullRequests: vi.fn(),
  refresh: vi.fn(),
  syncState: undefined as
    | { status: 'running' | 'done' | 'error' | 'cancelled'; error?: string }
    | undefined,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getPrSyncStore: () => ({
    getState: () => mocks.syncState,
    isSyncing: () => false,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pullRequests: {
      forceFullSyncPullRequests: mocks.forceFullSyncPullRequests,
    },
  },
}));

vi.mock('@renderer/lib/providers/github-context-provider', () => ({
  useGithubContext: () => ({ user: null }),
}));

vi.mock('./usePullRequests', () => ({
  useFilterOptions: () => ({ data: undefined }),
  usePullRequests: () => ({
    dataUpdatedAt: mocks.dataUpdatedAt,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    loading: false,
    prs: [],
    refresh: mocks.refresh,
  }),
}));

const PROJECT_ID = 'project-1';
const REPOSITORY_URL = 'https://github.com/acme/repo';

function Harness() {
  const viewState = usePrViewState(PROJECT_ID, REPOSITORY_URL);
  return React.createElement(
    'div',
    { 'data-error': viewState.error ?? '', 'data-testid': 'state' },
    React.createElement(
      'button',
      {
        'data-testid': 'refresh',
        onClick: () => void viewState.handleRefresh(),
      },
      'Refresh'
    ),
    React.createElement(
      'button',
      {
        'data-testid': 'force',
        onClick: () => void viewState.handleForceFullSync(),
      },
      'Force'
    )
  );
}

describe('usePrViewState', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.dataUpdatedAt = 0;
    mocks.refresh.mockReset();
    mocks.forceFullSyncPullRequests.mockReset();
    mocks.forceFullSyncPullRequests.mockResolvedValue({ success: true, data: undefined });
    mocks.syncState = undefined;

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
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderHarness(): Promise<HTMLDivElement> {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Harness)
        )
      );
    });

    const state = container.querySelector('[data-testid="state"]') as HTMLDivElement | null;
    expect(state).not.toBeNull();
    return state!;
  }

  it('clears a manual refresh error after a successful data update', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('sync failed'));
    const state = await renderHarness();
    const refreshButton = container.querySelector('[data-testid="refresh"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(state.getAttribute('data-error')).toBe('sync failed'));

    mocks.dataUpdatedAt = 1;
    await renderHarness();

    await vi.waitFor(() => expect(state.getAttribute('data-error')).toBe(''));
  });

  it('hides stale manual refresh errors after sync completion', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('sync failed'));
    const state = await renderHarness();
    const refreshButton = container.querySelector('[data-testid="refresh"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(state.getAttribute('data-error')).toBe('sync failed'));

    mocks.syncState = { status: 'done' };
    await renderHarness();

    expect(state.getAttribute('data-error')).toBe('');
  });

  it('surfaces rejected force-full sync RPCs', async () => {
    mocks.forceFullSyncPullRequests.mockRejectedValueOnce(new Error('transport down'));
    const state = await renderHarness();
    const forceButton = container.querySelector('[data-testid="force"]');
    expect(forceButton).not.toBeNull();

    await act(async () => {
      forceButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(state.getAttribute('data-error')).toBe('transport down'));
  });
});

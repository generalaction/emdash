import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePullRequests } from './usePullRequests';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  syncPullRequests: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pullRequests: {
      listPullRequests: mocks.listPullRequests,
      syncPullRequests: mocks.syncPullRequests,
    },
  },
}));

const PROJECT_ID = 'project-1';
const REPOSITORY_URL = 'https://github.com/acme/repo';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness() {
  const { refresh } = usePullRequests(PROJECT_ID, REPOSITORY_URL);
  const [error, setError] = useState('');

  return React.createElement(
    'button',
    {
      'data-error': error,
      'data-testid': 'refresh',
      onClick: () =>
        void refresh().catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        }),
    },
    'Refresh'
  );
}

describe('usePullRequests', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.listPullRequests.mockResolvedValue({ success: true, data: { prs: [] } });

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

  async function renderHarness(): Promise<HTMLButtonElement> {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Harness)
        )
      );
    });

    await vi.waitFor(() => expect(mocks.listPullRequests).toHaveBeenCalledTimes(1));
    const button = container.querySelector('[data-testid="refresh"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    return button!;
  }

  it('waits for sync completion before invalidating the list query', async () => {
    const sync = deferred<{ success: true; data: void }>();
    mocks.syncPullRequests.mockReturnValue(sync.promise);
    const button = await renderHarness();

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.syncPullRequests).toHaveBeenCalledTimes(1);
    expect(mocks.listPullRequests).toHaveBeenCalledTimes(1);

    await act(async () => {
      sync.resolve({ success: true, data: undefined });
    });

    await vi.waitFor(() => expect(mocks.listPullRequests).toHaveBeenCalledTimes(2));
  });

  it('surfaces sync errors without invalidating the list query', async () => {
    mocks.syncPullRequests.mockResolvedValue({
      success: false,
      error: {
        type: 'github_not_found_or_no_access',
        host: 'github.com',
        message:
          'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      },
    });
    const button = await renderHarness();

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() =>
      expect(button.getAttribute('data-error')).toContain(
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
      )
    );
    expect(mocks.listPullRequests).toHaveBeenCalledTimes(1);
  });
});

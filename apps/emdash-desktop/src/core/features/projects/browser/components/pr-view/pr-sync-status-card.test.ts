import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncState } from '@core/services/pull-requests/api';
import { PrSyncStatusCard } from './pr-sync-status-card';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  syncState: undefined as SyncState | undefined,
  refreshRepository: vi.fn(async () => ({ success: true })),
  refreshHistory: vi.fn(async () => ({ success: true })),
  canCancelHistory: false,
  cancelHistory: vi.fn(),
}));

vi.mock('@core/services/pull-requests/browser', () => ({
  usePullRequestsStore: () => ({
    syncState: () => mocks.syncState,
    refreshRepository: mocks.refreshRepository,
    refreshHistory: mocks.refreshHistory,
    canCancelHistory: () => mocks.canCancelHistory,
    cancelHistory: mocks.cancelHistory,
  }),
}));

const REPOSITORY_URL = 'https://github.com/acme/repo';

describe('PrSyncStatusCard', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.syncState = undefined;
    mocks.canCancelHistory = false;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('renders manual refresh errors in the sync status card', async () => {
    await act(async () => {
      root.render(
        React.createElement(PrSyncStatusCard, {
          repositoryUrl: REPOSITORY_URL,
          manualError: 'GitHub API is disabled for this project.',
        })
      );
    });

    expect(container.textContent).toContain('Sync failed');
    expect(container.textContent).toContain('GitHub API is disabled for this project.');
    expect(container.querySelector('[data-slot="list-popover-card"]')).not.toBeNull();
    expect(container.querySelector('[data-status="destructive"]')).not.toBeNull();
  });

  it('does not offer cancellation of automatic repository refreshes', async () => {
    mocks.syncState = { phase: 'running', kind: 'repository' };
    await act(async () => {
      root.render(React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL }));
    });
    expect(container.textContent).toContain('Refreshing PRs');
    expect(container.textContent).not.toContain('Cancel');
  });

  it('does not report successful completion when history is cancelled after inventory succeeded', async () => {
    mocks.syncState = { phase: 'running', kind: 'history', lastSyncedAt: 1000 };
    await act(async () => {
      root.render(React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL }));
    });
    mocks.syncState = { phase: 'idle', kind: 'history', lastSyncedAt: 1000, outcome: 'cancelled' };
    await act(async () => {
      root.render(
        React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL, manualError: null })
      );
    });
    expect(container.textContent).not.toContain('Sync complete');
  });

  it.each(['repository', 'history'] as const)(
    'reports an actual successful %s operation',
    async (kind) => {
      mocks.syncState = { phase: 'idle', kind, outcome: 'success' };
      await act(async () => {
        root.render(React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL }));
      });
      expect(container.textContent).toContain('Sync complete');
    }
  );

  it('offers cancellation only for locally owned history, even during inventory refresh', async () => {
    mocks.syncState = { phase: 'running', kind: 'repository' };
    mocks.canCancelHistory = true;
    await act(async () => {
      root.render(React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL }));
    });
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    );
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());
    expect(mocks.cancelHistory).toHaveBeenCalledWith(REPOSITORY_URL);
  });

  it.each(['repository', 'history'] as const)('retries the failed %s operation', async (kind) => {
    mocks.syncState = {
      phase: 'error',
      kind,
      error: { type: 'sync_failed', message: 'GitHub unavailable' },
    };
    await act(async () => {
      root.render(React.createElement(PrSyncStatusCard, { repositoryUrl: REPOSITORY_URL }));
    });
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry'
    );
    await act(async () => retry?.click());
    expect(
      kind === 'history' ? mocks.refreshHistory : mocks.refreshRepository
    ).toHaveBeenCalledWith(REPOSITORY_URL);
    expect(
      kind === 'history' ? mocks.refreshRepository : mocks.refreshHistory
    ).not.toHaveBeenCalled();
  });
});

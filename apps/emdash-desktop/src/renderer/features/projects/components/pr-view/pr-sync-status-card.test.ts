import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrSyncStatusCard } from './pr-sync-status-card';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  syncState: undefined,
  sync: vi.fn(),
  cancelSync: vi.fn(),
}));

vi.mock('@root/src/core/services/pull-requests/browser', () => ({
  usePullRequestsStore: () => ({
    syncState: () => mocks.syncState,
    sync: mocks.sync,
    cancelSync: mocks.cancelSync,
  }),
}));

const REPOSITORY_URL = 'https://github.com/acme/repo';

describe('PrSyncStatusCard', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.syncState = undefined;
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
    expect(container.querySelector('.border-border-destructive')).not.toBeNull();
    expect(container.querySelector('.bg-background-destructive')).not.toBeNull();
  });
});

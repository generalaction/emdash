import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrSyncStatusCard } from './pr-sync-status-card';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  syncState: undefined as
    | {
        status: 'running' | 'done' | 'error' | 'cancelled';
        kind: 'full' | 'incremental' | 'single';
        error?: string;
      }
    | undefined,
  retry: vi.fn(),
  clear: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getPrSyncStore: () => ({
    getState: () => mocks.syncState,
    retry: mocks.retry,
    clear: mocks.clear,
    cancel: mocks.cancel,
  }),
}));

const PROJECT_ID = 'project-1';
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
          projectId: PROJECT_ID,
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

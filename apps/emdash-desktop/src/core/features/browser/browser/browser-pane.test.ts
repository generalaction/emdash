import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPane } from './browser-pane';
import { browserSessionStore } from './browser-session-store';

const browserRpc = vi.hoisted(() => ({
  bindWebContents: vi.fn(),
  registerSession: vi.fn(),
  setActiveBrowser: vi.fn(),
}));

vi.mock('@core/features/tasks/browser/task-view-context', () => ({
  usePreviewServers: () => ({ urls: [] }),
}));

vi.mock('@core/features/workbench/browser/tabs/pane-context', () => ({
  usePaneContext: () => ({
    pane: { setNextTabActive: vi.fn(), setPreviousTabActive: vi.fn() },
  }),
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
  events: { on: vi.fn(() => () => {}) },
  rpc: { browser: browserRpc },
}));

vi.mock('./browser-toolbar', async () => {
  const React = await import('react');
  return {
    BrowserToolbar: ({ onNavigate }: { onNavigate?: (url: string) => boolean }) =>
      React.createElement('button', { onClick: () => onNavigate?.('https://linkedin.com/') }),
  };
});

describe('BrowserPane', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    browserSessionStore.clear();
    browserRpc.registerSession.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    browserSessionStore.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('does not load the submitted URL twice when the webview becomes ready', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const webview = container.querySelector<HTMLElement>('webview')!;
    const loadURL = vi.fn();
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'LinkedIn',
      getURL: () => webview.getAttribute('src'),
      getWebContentsId: () => 123,
      loadURL,
      setZoomFactor: vi.fn(),
    });

    await act(async () => webview.dispatchEvent(new dom.window.Event('dom-ready')));

    expect(webview.getAttribute('src')).toBe('https://linkedin.com/');
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('renders a minimal load error state', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'https://missing.invalid/',
    });
    browserSessionStore.updateSession(session.browserId, {
      isLoading: false,
      loadError: {
        code: -105,
        description: 'net::ERR_NAME_NOT_RESOLVED',
        url: 'https://missing.invalid/',
      },
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });

    expect(container.querySelector('h1')?.textContent).toBe("This site can't be reached");
    expect(container.querySelector('p')?.textContent).toBe(
      "missing.invalid's server IP address could not be found. (ERR_NAME_NOT_RESOLVED)"
    );
    expect(container.textContent).not.toContain('Try:');
    expect(
      Array.from(container.querySelectorAll('button'))
        .map((button) => button.textContent)
        .filter(Boolean)
    ).toEqual(['Reload', 'Open externally']);
  });
});

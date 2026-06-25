import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneContext, type PaneContextValue } from '@renderer/features/tabs/pane-context';
import { BrowserPane } from './browser-pane';
import { browserSessionStore } from './browser-session-store';

const browserRpc = vi.hoisted(() => ({
  bindWebContents: vi.fn(),
  registerSession: vi.fn(),
  setActiveBrowser: vi.fn(),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  usePreviewServers: () => ({ urls: [] }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    browser: browserRpc,
  },
}));

vi.mock('./browser-toolbar', async () => {
  const React = await import('react');
  return {
    BrowserToolbar: ({ onNavigate }: { onNavigate?: (url: string) => boolean }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onNavigate?.('https://linkedin.com/'),
        },
        'Navigate to LinkedIn'
      ),
  };
});

describe('BrowserPane', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    browserSessionStore.clear();
    browserRpc.bindWebContents.mockReset();
    browserRpc.registerSession.mockReset();
    browserRpc.registerSession.mockResolvedValue({ success: true });
    browserRpc.setActiveBrowser.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    browserSessionStore.clear();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('does not replay start-page navigation through loadURL after the webview becomes ready', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    const paneContextValue = {
      paneId: 'pane-1',
      pane: {
        setNextTabActive: vi.fn(),
        setPreviousTabActive: vi.fn(),
      },
      isFocusedPane: true,
    } as unknown as PaneContextValue;

    await act(async () => {
      root.render(
        React.createElement(
          PaneContext.Provider,
          { value: paneContextValue },
          React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
        )
      );
    });

    await act(async () => {});

    const navigateButton = container.querySelector<HTMLButtonElement>('button');
    expect(navigateButton).not.toBeNull();

    await act(async () => {
      navigateButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const webview = container.querySelector<HTMLElement>('webview');
    expect(webview).not.toBeNull();
    expect(webview?.getAttribute('src')).toBe('https://linkedin.com/');

    const loadURL = vi.fn();
    Object.assign(webview!, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'LinkedIn',
      getURL: () => webview?.getAttribute('src') ?? 'about:blank',
      getWebContentsId: () => 123,
      goBack: vi.fn(),
      goForward: vi.fn(),
      loadURL,
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
      setZoomFactor: vi.fn(),
      stop: vi.fn(),
    });

    await act(async () => {
      webview?.dispatchEvent(new dom.window.Event('dom-ready'));
    });
    await act(async () => {});

    expect(loadURL).not.toHaveBeenCalled();
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://linkedin.com/',
      title: 'LinkedIn',
    });
  });
});

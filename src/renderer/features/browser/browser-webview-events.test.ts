import { beforeEach, describe, expect, it } from 'vitest';
import { browserDiagnosticsStore } from './browser-diagnostics-store';
import { browserSessionStore } from './browser-session-store';
import { bindBrowserWebviewEvents } from './browser-webview-events';
import type { BrowserWebviewElement, BrowserWebviewEventMap } from './browser-webview-types';

class FakeBrowserWebview {
  url = 'about:blank';
  titleText = '';
  back = false;
  forward = false;
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  canGoBack(): boolean {
    return this.back;
  }

  canGoForward(): boolean {
    return this.forward;
  }

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.titleText;
  }

  addEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener as (event: unknown) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void {
    this.listeners.get(type)?.delete(listener as (event: unknown) => void);
  }

  emit(type: keyof BrowserWebviewEventMap, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function asWebview(fake: FakeBrowserWebview): BrowserWebviewElement {
  return fake as unknown as BrowserWebviewElement;
}

describe('bindBrowserWebviewEvents', () => {
  beforeEach(() => {
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
  });

  it('updates browser session state from webview events', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    webview.url = 'https://example.com/';
    webview.titleText = 'Example';
    webview.back = true;

    bindBrowserWebviewEvents(session.browserId, asWebview(webview));

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/',
      title: 'Example',
      canGoBack: true,
      canGoForward: false,
    });

    webview.emit('did-start-loading');
    expect(browserSessionStore.getSession(session.browserId)?.isLoading).toBe(true);

    webview.emit('did-navigate', { url: 'https://example.com/docs' });
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/docs',
      loadError: undefined,
    });

    webview.emit('page-title-updated', { title: 'Docs' });
    webview.emit('page-favicon-updated', { favicons: ['https://example.com/favicon.ico'] });
    webview.emit('console-message', {
      level: 3,
      message: 'Unhandled error token=secret',
      line: 42,
      sourceId: 'https://example.com/app.js',
    });
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      title: 'Docs',
      faviconUrl: 'https://example.com/favicon.ico',
    });

    webview.emit('did-fail-load', {
      errorCode: -105,
      errorDescription: 'Name not resolved',
      validatedURL: 'https://missing.invalid/',
    });
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      isLoading: false,
      loadError: {
        code: -105,
        description: 'Name not resolved',
        url: 'https://missing.invalid/',
      },
    });
    expect(browserDiagnosticsStore.entriesForBrowser(session.browserId)).toMatchObject([
      {
        level: 'error',
        source: 'console',
        message: 'Unhandled error token=[REDACTED]',
        line: 42,
      },
      {
        level: 'error',
        source: 'navigation',
        message: 'Name not resolved',
        url: 'https://missing.invalid/',
      },
    ]);
  });

  it('removes listeners when disposed', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    const dispose = bindBrowserWebviewEvents(session.browserId, asWebview(webview));

    dispose();
    webview.emit('did-start-loading');

    expect(browserSessionStore.getSession(session.browserId)?.isLoading).toBe(false);
  });
});

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWebviewHost } from './browser-webview-host';

const browserRpc = vi.hoisted(() => ({
  bindWebContents: vi.fn(),
  registerSession: vi.fn(),
  unregisterSession: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { browser: browserRpc },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('BrowserWebviewHost', () => {
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
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    browserRpc.registerSession.mockResolvedValue({ success: true });
    browserRpc.bindWebContents.mockResolvedValue({ success: true });
    browserRpc.unregisterSession.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  function renderHost(props: Partial<React.ComponentProps<typeof BrowserWebviewHost>> = {}): void {
    root.render(
      React.createElement(BrowserWebviewHost, {
        lifecycleKey: 'lease-1',
        browserId: 'browser-1',
        partition: 'persist:emdash-browser-profile',
        src: 'http://127.0.0.1:4173/',
        registration: 'renderer',
        ...props,
      })
    );
  }

  function prepareWebview(webview: HTMLElement, id = 123): void {
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'Preview',
      getURL: () => webview.getAttribute('src'),
      getWebContentsId: () => id,
      loadURL: vi.fn(),
      setZoomFactor: vi.fn(),
    });
  }

  it('gates mounting on registration and reports bound only after a successful awaited bind', async () => {
    const registration = deferred<{ success: boolean }>();
    const binding = deferred<{ success: boolean }>();
    browserRpc.registerSession.mockReturnValue(registration.promise);
    browserRpc.bindWebContents.mockReturnValue(binding.promise);
    const onBound = vi.fn();

    await act(async () => renderHost({ onBound }));
    expect(container.querySelector('webview')).toBeNull();

    await act(async () => registration.resolve({ success: true }));
    const webview = container.querySelector<HTMLElement>('webview')!;
    prepareWebview(webview);
    await act(async () => webview.dispatchEvent(new dom.window.Event('dom-ready')));
    expect(onBound).not.toHaveBeenCalled();

    await act(async () => binding.resolve({ success: true }));
    expect(browserRpc.bindWebContents).toHaveBeenCalledWith({
      browserId: 'browser-1',
      webContentsId: 123,
    });
    expect(onBound).toHaveBeenCalledOnce();
  });

  it('never reports ready after bind failure or a stale lifecycle completion', async () => {
    const oldBinding = deferred<{ success: boolean }>();
    browserRpc.bindWebContents.mockReturnValueOnce(oldBinding.promise);
    const onBound = vi.fn();
    const onBindFailed = vi.fn();

    await act(async () => renderHost({ registration: 'main', onBound, onBindFailed }));
    const oldWebview = container.querySelector<HTMLElement>('webview')!;
    prepareWebview(oldWebview, 1);
    await act(async () => oldWebview.dispatchEvent(new dom.window.Event('dom-ready')));

    await act(async () =>
      renderHost({
        lifecycleKey: 'lease-2',
        browserId: 'browser-2',
        registration: 'main',
        onBound,
        onBindFailed,
      })
    );
    await act(async () => oldBinding.resolve({ success: true }));
    expect(onBound).not.toHaveBeenCalled();

    const newWebview = container.querySelector<HTMLElement>('webview')!;
    prepareWebview(newWebview, 2);
    browserRpc.bindWebContents.mockResolvedValueOnce({ success: false });
    await act(async () => newWebview.dispatchEvent(new dom.window.Event('dom-ready')));
    expect(onBound).not.toHaveBeenCalled();
    expect(onBindFailed).toHaveBeenCalledOnce();
  });

  it('keeps the same webview alive while hidden and disposes one lifecycle exactly once', async () => {
    const onDisposed = vi.fn();
    await act(async () => renderHost({ registration: 'main', onDisposed }));
    const webview = container.querySelector<HTMLElement>('webview')!;
    prepareWebview(webview);
    await act(async () => webview.dispatchEvent(new dom.window.Event('dom-ready')));

    await act(async () => renderHost({ registration: 'main', hidden: true, onDisposed }));
    expect(container.querySelector('webview')).toBe(webview);
    expect(browserRpc.bindWebContents).toHaveBeenCalledTimes(1);
    expect(webview.getAttribute('aria-hidden')).toBe('true');
    expect(webview.getAttribute('tabindex')).toBe('-1');
    expect(webview.style.position).toBe('fixed');
    expect(webview.style.left).toBe('-10000px');
    expect(webview.style.width).toBe('1280px');
    expect(webview.style.height).toBe('720px');

    act(() => root.unmount());
    expect(onDisposed).toHaveBeenCalledOnce();
  });

  it('does not re-register or unregister when only the webview revision changes', async () => {
    await act(async () => renderHost());
    expect(browserRpc.registerSession).toHaveBeenCalledOnce();
    const first = container.querySelector('webview');

    await act(async () => renderHost({ lifecycleKey: 'lease-1:revision-2' }));

    expect(container.querySelector('webview')).not.toBe(first);
    expect(browserRpc.registerSession).toHaveBeenCalledOnce();
    expect(browserRpc.unregisterSession).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(browserRpc.unregisterSession).not.toHaveBeenCalled();
  });
});

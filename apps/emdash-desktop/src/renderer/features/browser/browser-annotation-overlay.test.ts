import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationOverlay } from './browser-annotation-overlay';
import type { BrowserAnnotationsStore } from './browser-annotations-store';
import type { BrowserWebviewAdapter } from './browser-webview-types';

const mocks = vi.hoisted(() => ({
  captureTelemetry: vi.fn(),
}));

vi.mock('@renderer/utils/telemetryClient', () => ({
  captureTelemetry: mocks.captureTelemetry,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

function createAdapter(overrides: Partial<BrowserWebviewAdapter> = {}): BrowserWebviewAdapter {
  return {
    canGoBack: () => false,
    canGoForward: () => false,
    currentUrl: () => 'http://localhost:3000',
    title: () => 'Local app',
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    stop: vi.fn(),
    loadUrl: vi.fn(),
    setZoomFactor: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue(null),
    focus: vi.fn(),
    ...overrides,
  };
}

describe('BrowserAnnotationOverlay', () => {
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
    vi.stubGlobal('WheelEvent', dom.window.WheelEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      configurable: true,
      value: vi.fn(),
    });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  async function renderOverlay(
    adapter: BrowserWebviewAdapter,
    store: Partial<BrowserAnnotationsStore> = {}
  ) {
    await act(async () => {
      root.render(
        React.createElement(BrowserAnnotationOverlay, {
          active: true,
          adapter,
          browserId: 'browser-1',
          store: {
            pendingCount: 0,
            addAnnotation: vi.fn(),
            ...store,
          } as unknown as BrowserAnnotationsStore,
          onClose: vi.fn(),
        })
      );
    });
    const overlay = container.querySelector('[aria-label="Browser annotation overlay"]');
    if (!(overlay instanceof dom.window.HTMLElement)) {
      throw new Error('Expected annotation overlay');
    }
    Object.defineProperty(overlay, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    return overlay;
  }

  it('does not throw when hover capture script execution fails', async () => {
    const adapter = createAdapter({
      executeJavaScript: vi.fn().mockRejectedValue(new Error('webview navigated')),
    });
    const overlay = await renderOverlay(adapter);

    await act(async () => {
      overlay.dispatchEvent(
        new dom.window.MouseEvent('pointermove', {
          bubbles: true,
          clientX: 100,
          clientY: 120,
        })
      );
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    });

    expect(adapter.executeJavaScript).toHaveBeenCalledOnce();
  });

  it('does not throw when forwarded wheel scroll script execution fails', async () => {
    const adapter = createAdapter({
      executeJavaScript: vi.fn().mockRejectedValue(new Error('webview destroyed')),
    });
    const overlay = await renderOverlay(adapter);

    await act(async () => {
      overlay.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 120,
          deltaY: 80,
        })
      );
      await Promise.resolve();
    });

    expect(adapter.executeJavaScript).toHaveBeenCalledOnce();
  });

  it('renders the save shortcut in the annotation composer', async () => {
    const addAnnotation = vi.fn();
    const adapter = createAdapter({
      executeJavaScript: vi.fn().mockResolvedValue({
        kind: 'element',
        url: 'http://localhost:3000/settings',
        title: 'Settings',
        elementPath: 'main > button',
        element: 'button',
        nearbyText: 'Save changes',
        selectedText: 'Private selected text',
        x: 100,
        y: 120,
        boundingBox: { x: 90, y: 110, width: 120, height: 32 },
      }),
    });
    const overlay = await renderOverlay(adapter, { pendingCount: 1, addAnnotation });

    await act(async () => {
      overlay.dispatchEvent(
        new dom.window.MouseEvent('pointerdown', {
          bubbles: true,
          clientX: 100,
          clientY: 120,
        })
      );
      await Promise.resolve();
    });
    await act(async () => {
      overlay.dispatchEvent(
        new dom.window.MouseEvent('pointerup', {
          bubbles: true,
          clientX: 100,
          clientY: 120,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Save');
    expect(container.querySelector('[data-slot="shortcut"]')).not.toBeNull();
    expect(addAnnotation).not.toHaveBeenCalled();
  });
});

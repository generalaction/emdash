import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BrowserWebviewAdapter,
  BrowserWebviewElement,
  BrowserWebviewEventMap,
} from '@renderer/features/browser/browser-webview-types';
import { useBrowserFind } from '@renderer/features/browser/use-browser-find';
import type { FindSearchStatus } from '@renderer/lib/find/types';

/** Minimal fake webview: tracks findInPage requestIds and lets the test fire found-in-page events. */
function createFakeWebview() {
  let nextRequestId = 1;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const findCalls: string[] = [];
  const findOptions: Array<Electron.FindInPageOptions | undefined> = [];

  const webview = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as BrowserWebviewElement;

  const adapter: BrowserWebviewAdapter = {
    canGoBack: () => false,
    canGoForward: () => false,
    currentUrl: () => '',
    title: () => '',
    goBack: () => {},
    goForward: () => {},
    reload: () => {},
    reloadIgnoringCache: () => {},
    stop: () => {},
    loadUrl: async () => {},
    setZoomFactor: () => {},
    focus: () => {},
    find: (text: string, options?: Electron.FindInPageOptions) => {
      findCalls.push(text);
      findOptions.push(options);
      return nextRequestId++;
    },
    stopFind: () => {},
  };

  const emit = (requestId: number, matches: number, activeMatchOrdinal = 1) => {
    const event: BrowserWebviewEventMap['found-in-page'] = {
      result: {
        requestId,
        matches,
        activeMatchOrdinal,
        selectionArea: { x: 0, y: 0, width: 0, height: 0 },
        finalUpdate: true,
      },
    };
    listeners.get('found-in-page')?.forEach((listener) => listener(event));
  };

  return { webview, adapter, emit, findCalls, findOptions };
}

let latestStatus: FindSearchStatus | undefined;
let triggerQueryChange: ((q: string) => void) | undefined;
let triggerStepSearch: ((direction: 'next' | 'prev') => void) | undefined;

function Probe({
  webview,
  adapter,
}: {
  webview: BrowserWebviewElement;
  adapter: BrowserWebviewAdapter;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { searchStatus, handleSearchQueryChange, stepSearch } = useBrowserFind({
    adapter,
    webview,
    containerRef,
    enabled: true,
    targetId: 'browser-test',
  });
  latestStatus = searchStatus;
  triggerQueryChange = handleSearchQueryChange;
  triggerStepSearch = stepSearch;
  return <div ref={containerRef} />;
}

describe('useBrowserFind', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestStatus = undefined;
    triggerQueryChange = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('ignores a stale found-in-page result that resolves after a newer request', () => {
    const { webview, adapter, emit, findCalls } = createFakeWebview();

    act(() => {
      root.render(<Probe webview={webview} adapter={adapter} />);
    });

    // Type "i" then "in" — two overlapping findInPage requests, ids 1 and 2.
    act(() => triggerQueryChange?.('i'));
    act(() => triggerQueryChange?.('in'));
    expect(findCalls).toEqual(['i', 'in']);

    // Simulate them resolving out of order: the newer request (id 2, "in")
    // finishes first, then the stale one (id 1, "i") arrives late.
    act(() => emit(2, 3));
    expect(latestStatus).toEqual({ found: true, currentIndex: 1, total: 3 });

    act(() => emit(1, 12));
    // Must still reflect "in"'s result — the stale "i" result is ignored.
    expect(latestStatus).toEqual({ found: true, currentIndex: 1, total: 3 });
  });

  it('accepts a result that matches the latest request', () => {
    const { webview, adapter, emit } = createFakeWebview();

    act(() => {
      root.render(<Probe webview={webview} adapter={adapter} />);
    });

    act(() => triggerQueryChange?.('include'));
    act(() => emit(1, 5, 2));

    expect(latestStatus).toEqual({ found: true, currentIndex: 2, total: 5 });
  });

  it('starts a new find session on each query change and continues the same session when stepping', () => {
    // Electron's findNext option is misleadingly named: per Electron's own
    // docs it must be true to start a *new* search session (a changed
    // query) and false to continue the existing session (stepping through
    // matches of the same query) — the opposite of what the name suggests.
    // Getting this backwards meant typing a new query never actually reset
    // the search; it kept matching whatever the very first query locked
    // onto, so results looked stuck until Enter (stepSearch) coincidentally
    // forced a fresh session.
    const { webview, adapter, findOptions } = createFakeWebview();

    act(() => {
      root.render(<Probe webview={webview} adapter={adapter} />);
    });

    act(() => triggerQueryChange?.('i'));
    act(() => triggerQueryChange?.('in'));
    act(() => triggerQueryChange?.('inc'));
    expect(findOptions.map((o) => o?.findNext)).toEqual([true, true, true]);

    act(() => triggerStepSearch?.('next'));
    act(() => triggerStepSearch?.('prev'));
    expect(findOptions.slice(3).map((o) => o?.findNext)).toEqual([false, false]);
  });
});

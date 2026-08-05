import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findTargetRegistry } from '@renderer/lib/find/find-target-registry';
import type { FindSearchStatus } from '@renderer/lib/find/types';
import { useDomTextSearch } from '@renderer/lib/find/use-dom-text-search';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

// A real MutationObserver's callback fires asynchronously as a microtask,
// even against genuine Chromium, so tests must wait a tick for it to run.
function waitForMutationObserver(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let latestStatus: FindSearchStatus | undefined;
let triggerQueryChange: ((q: string) => void) | undefined;
let containerEl: HTMLDivElement | null = null;

// Sets innerHTML once on mount only, rather than via React's own
// dangerouslySetInnerHTML prop (which React re-asserts on every re-render,
// including the re-render applyMatch's own setState calls trigger — that
// would silently wipe out the <mark> this hook just inserted, on every
// single match). This mirrors how the real consumers work: React owns the
// container element, but content inside it is written imperatively by
// something else (a markdown renderer, an ACP transcript stream) that only
// updates when its own source data changes, not on every render.
function Probe() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { searchStatus, handleSearchQueryChange } = useDomTextSearch({
    containerRef,
    enabled: true,
    targetId: 'dom-text-search-test',
  });
  latestStatus = searchStatus;
  triggerQueryChange = handleSearchQueryChange;
  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        containerEl = el;
        if (el && !el.dataset.initialized) {
          el.dataset.initialized = 'true';
          el.innerHTML = '<p>hello world</p>';
        }
      }}
    />
  );
}

describe('useDomTextSearch', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestStatus = undefined;
    triggerQueryChange = undefined;
    containerEl = null;
    findTargetRegistry.setActive(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    findTargetRegistry.setActive(null);
  });

  it('rebuilds the search after the container content changes externally (e.g. a streaming re-render)', async () => {
    // Regression coverage: applyMatch wraps a match in a raw <mark> element
    // inserted directly into content owned and re-rendered independently by
    // something else (a markdown buffer, the ACP transcript renderer). If
    // that content changes while a mark is present — e.g. a markdown buffer
    // edit, or an ACP response streaming in more text — the old code left
    // the stale mark's DOM reference in place with no way to notice the
    // underlying text nodes it pointed at were gone or shifted, so
    // subsequent searches or reconciliation could silently break. This
    // asserts the search transparently recovers by rebuilding against the
    // fresh content.
    act(() => {
      root.render(<Probe />);
    });
    // The MutationObserver only guards against corruption while a search is
    // genuinely open (matching the real component, where the query input
    // that calls handleSearchQueryChange only exists once isSearchOpen is
    // true) — open it the same way Cmd+F/Edit>Find does in the real app.
    act(() => {
      findTargetRegistry.setActive('dom-text-search-test');
      findTargetRegistry.activate();
    });

    act(() => triggerQueryChange?.('world'));
    expect(latestStatus).toEqual({ found: true, currentIndex: 1, total: 1 });

    const mark = containerEl?.querySelector('mark[data-find-current]');
    expect(mark?.textContent).toBe('world');

    // Simulate external content changing while the mark is active — e.g. a
    // streaming response appending a second "world" and changing the text
    // around the existing match. This mutates the DOM directly, the same
    // way a non-React renderer or a buffer update would, without going
    // through React at all.
    act(() => {
      containerEl!.innerHTML = '<p>hello there, world! world again</p>';
    });
    await act(async () => {
      await waitForMutationObserver();
    });

    // The search must reflect the new content (2 matches now), not remain
    // pinned to a stale reference into content that no longer exists in the
    // same shape.
    expect(latestStatus).toEqual({ found: true, currentIndex: 1, total: 2 });
    const marksAfter = containerEl?.querySelectorAll('mark[data-find-current]');
    expect(marksAfter).toHaveLength(1);
    expect(marksAfter?.[0]?.textContent).toBe('world');
  });

  it('does not rebuild the search in response to its own mark insert/remove', async () => {
    // The MutationObserver must ignore mutations the hook makes itself
    // (wrapping/unwrapping the <mark>) — otherwise every match navigation
    // would immediately re-trigger a rebuild of itself.
    act(() => {
      root.render(<Probe />);
    });
    act(() => {
      findTargetRegistry.setActive('dom-text-search-test');
      findTargetRegistry.activate();
    });

    act(() => triggerQueryChange?.('hello'));
    await act(async () => {
      await waitForMutationObserver();
    });
    expect(latestStatus).toEqual({ found: true, currentIndex: 1, total: 1 });

    // No external change occurred — status must be stable, and there must
    // still be exactly one mark (not corrupted by a spurious rebuild loop).
    const marks = containerEl?.querySelectorAll('mark[data-find-current]');
    expect(marks).toHaveLength(1);
  });
});

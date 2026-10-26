/**
 * @vitest-environment jsdom
 *
 * Regression tests for how the binding reads each `onLayoutChanged` and for
 * the react-resizable-panels traps it encapsulates (see the hook's doc
 * comments). The library is not rendered: each test reports exact layouts
 * against a fake group element whose panel sizes jsdom returns as set, either
 * plainly (like the library's ResizeObserver) or from inside a dispatched
 * input event (like its pointer, keyboard and double-click handlers), so
 * every event is unambiguously one of
 *
 * - a (re)registration (the panel set changed): never closes, never
 *   overwrites the persisted size, adopts the opened size when none exists;
 * - a user resize (reported during a user input event — the user-input
 *   guard): persists pixels, or closes below the threshold without
 *   persisting the sliver (the sliver guard);
 * - a group resize (anything else): never closes or persists, and
 *   re-derives a clamped panel once the group grows (the clamp guard).
 *
 * Plus the generation-id guard ("poisoned panel memory"): the library
 * restores a re-entering panel id from its in-memory registry, ignoring
 * `defaultSize`, so every reopen must get a fresh id, and the suffix must
 * never reach storage. Real layout behavior (drags, ResizeObserver, clamping)
 * is covered by the app's `workspace-layout-resize` browser test.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCollapsiblePanelBinding, type LayoutStorage } from './use-collapsible-panel-binding';

class MemoryStorage implements LayoutStorage {
  readonly map = new Map<string, string>();
  getItem = (key: string): string | null => this.map.get(key) ?? null;
  setItem = vi.fn((key: string, value: string): void => {
    this.map.set(key, value);
  });
}

const SIZE_KEY = 'collapsible-panel-size:test-group:side';
// Library-internal key format: `react-resizable-panels:${id}:${...panelIds}`.
const LEGACY_KEY = 'react-resizable-panels:test-group:main:side';

/**
 * A group element as the binding measures it: the sum of its `data-panel`
 * children's rendered sizes along the orientation. One panel carries the
 * whole size; the separator's size must not count.
 */
function fakeGroup(orientation: 'horizontal' | 'vertical') {
  const group = document.createElement('div');
  const panel = document.createElement('div');
  panel.setAttribute('data-panel', '');
  const separator = document.createElement('div');
  group.append(panel, separator);
  let size = 0;
  const rect = (length: number) =>
    orientation === 'horizontal' ? new DOMRect(0, 0, length, 10) : new DOMRect(0, 0, 10, length);
  panel.getBoundingClientRect = () => rect(size);
  separator.getBoundingClientRect = () => rect(999);
  return { group, setSize: (next: number) => (size = next) };
}

function setup({
  open = true,
  stored,
  legacy,
  orientation = 'horizontal',
}: {
  open?: boolean;
  stored?: string;
  legacy?: string;
  orientation?: 'horizontal' | 'vertical';
} = {}) {
  const storage = new MemoryStorage();
  if (stored !== undefined) storage.map.set(SIZE_KEY, stored);
  if (legacy !== undefined) storage.map.set(LEGACY_KEY, legacy);
  const onCloseRequest = vi.fn();
  const view = renderHook(
    (props: { open: boolean }) =>
      useCollapsiblePanelBinding({
        storageKey: 'test-group',
        storage,
        panelIds: ['main', 'side'],
        collapsiblePanelId: 'side',
        orientation,
        open: props.open,
        onCloseRequest,
        closeThreshold: 8,
      }),
    { initialProps: { open } }
  );
  const { group, setSize } = fakeGroup(orientation);
  view.result.current.groupProps.elementRef.current = group;

  const layoutAt = (groupSize: number, side: number) => {
    setSize(groupSize);
    return { main: 100 - side, [view.result.current.collapsiblePanelProps.id]: side };
  };
  /**
   * Reports a settled layout outside any input event, like the library's
   * ResizeObserver and registration paths: the group is `groupSize` px, the
   * panel `side` percent.
   */
  const report = (groupSize: number, side: number) => {
    const layout = layoutAt(groupSize, side);
    act(() => view.result.current.groupProps.onLayoutChanged(layout));
  };
  /** Reports a layout from inside an input event's dispatch, like a user resize. */
  const resize = (groupSize: number, side: number, type = 'pointerup') => {
    const layout = layoutAt(groupSize, side);
    act(() => {
      document.addEventListener(
        type,
        () => view.result.current.groupProps.onLayoutChanged(layout),
        { once: true }
      );
      document.dispatchEvent(new Event(type));
    });
  };
  const reopen = () => {
    view.rerender({ open: false });
    view.rerender({ open: true });
  };
  return { storage, onCloseRequest, view, report, resize, reopen };
}

describe('useCollapsiblePanelBinding', () => {
  describe('event classification', () => {
    it('adopts the size the panel first opens at when nothing is persisted yet', () => {
      const { storage, report } = setup();

      report(1000, 25);

      expect(storage.getItem(SIZE_KEY)).toBe('250px');
    });

    it('persists a settled user resize in pixels under the stable storage key', () => {
      const { storage, report, resize } = setup();

      report(1000, 25);
      resize(1000, 30.04);

      expect(storage.getItem(SIZE_KEY)).toBe('300px');
    });

    it('never overwrites the persisted size when the panel opens clamped', () => {
      const { storage, report } = setup({ stored: '400px' });

      // Opened into a group too small for 400px: the library clamped it.
      report(1000, 30);

      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('never persists or closes on a group resize', () => {
      const { storage, onCloseRequest, report } = setup();
      report(1000, 30);
      storage.setItem.mockClear();

      // Pixel size kept (300px), then clamped, then far below the threshold.
      report(2000, 15);
      report(800, 30);
      report(6000, 4);

      expect(storage.setItem).not.toHaveBeenCalled();
      expect(onCloseRequest).not.toHaveBeenCalled();
    });

    it('measures the group along a vertical orientation', () => {
      const { view, storage, report } = setup({ orientation: 'vertical' });

      report(800, 25);

      expect(view.result.current.groupProps.orientation).toBe('vertical');
      expect(storage.getItem(SIZE_KEY)).toBe('200px');
    });
  });

  describe('user-input guard', () => {
    it('treats layouts reported while a drag, key or double-click is dispatched as user resizes', () => {
      const { storage, report, resize } = setup();
      report(1000, 25);

      resize(1000, 30, 'pointerup');
      expect(storage.getItem(SIZE_KEY)).toBe('300px');
      // A drag released outside the window ends on the next buttonless move.
      resize(1000, 32, 'pointermove');
      expect(storage.getItem(SIZE_KEY)).toBe('320px');
      resize(1000, 35, 'keydown');
      expect(storage.getItem(SIZE_KEY)).toBe('350px');
      resize(1000, 25, 'dblclick');
      expect(storage.getItem(SIZE_KEY)).toBe('250px');
    });

    it('never treats a layout outside an input event as a user resize, even at an unchanged group size', () => {
      const { storage, onCloseRequest, report } = setup();

      report(1000, 25);
      // A sub-pixel window resize, or a split-dependent rounding of the group
      // size, must not read as a drag.
      report(1000, 30);
      report(1000, 4);

      expect(storage.getItem(SIZE_KEY)).toBe('250px');
      expect(onCloseRequest).not.toHaveBeenCalled();
    });

    it('stops treating layouts as user resizes once the input event has been dispatched', () => {
      const { storage, report } = setup();
      report(1000, 25);

      act(() => {
        document.dispatchEvent(new Event('pointerup'));
      });
      report(1200, 30);

      expect(storage.getItem(SIZE_KEY)).toBe('250px');
    });

    it('ignores input events that never end a resize', () => {
      const { storage, report, resize } = setup();

      report(1000, 25);
      resize(1000, 30, 'click');

      expect(storage.getItem(SIZE_KEY)).toBe('250px');
    });
  });

  describe('sliver guard', () => {
    it('requests close instead of persisting when a drag settles below the threshold', () => {
      const { storage, onCloseRequest, report, resize } = setup();

      report(1000, 30);
      resize(1000, 4);

      expect(onCloseRequest).toHaveBeenCalledTimes(1);
      // The sub-threshold sliver must never be persisted; the last good size stays.
      expect(storage.getItem(SIZE_KEY)).toBe('300px');
    });

    it('requests close when the library snaps a collapsible panel to its 0% collapsedSize', () => {
      const { storage, onCloseRequest, report, resize } = setup();

      report(1000, 30);
      // Hosts that set `minSize` + `collapsible` + `collapsedSize="0%"` never
      // settle at intermediate slivers: dragging below `minSize` makes the
      // library snap the layout straight to 0.
      resize(1000, 0);

      expect(onCloseRequest).toHaveBeenCalledTimes(1);
      expect(storage.getItem(SIZE_KEY)).toBe('300px');
    });

    it('never persists layouts reported while closed (mount/unmount reflows)', () => {
      const { storage, onCloseRequest, view } = setup({ open: false });

      act(() => view.result.current.groupProps.onLayoutChanged({ main: 100 }));

      expect(onCloseRequest).not.toHaveBeenCalled();
      expect(storage.map.size).toBe(0);
    });

    it('never adopts a sub-threshold size the panel opens at', () => {
      const { storage, report } = setup({ legacy: JSON.stringify({ main: 97, side: 3 }) });

      report(1000, 3);

      expect(storage.getItem(SIZE_KEY)).toBeNull();
    });
  });

  describe('generation-id guard', () => {
    it('uses the canonical panel id before the first close', () => {
      const { view } = setup();
      expect(view.result.current.collapsiblePanelProps.id).toBe('side');
    });

    it('hands out a fresh generation-suffixed id on every reopen', () => {
      const { view, report, resize, reopen } = setup();

      // A threshold close…
      report(1000, 30);
      resize(1000, 5);
      reopen();
      const firstReopenId = view.result.current.collapsiblePanelProps.id;
      // …and a plain toggle both reopen as a new identity.
      reopen();
      const secondReopenId = view.result.current.collapsiblePanelProps.id;

      expect(firstReopenId).not.toBe('side');
      expect(secondReopenId).not.toBe('side');
      expect(secondReopenId).not.toBe(firstReopenId);
    });

    it('reopens at the persisted pixel size', () => {
      const { view, report, resize, reopen } = setup();

      report(1000, 25);
      resize(1000, 30);
      reopen();

      expect(view.result.current.collapsiblePanelProps.defaultSize).toBe('300px');
    });

    it('never lets the generation suffix reach storage', () => {
      const { storage, view, report, resize, reopen } = setup();

      reopen();
      const generationId = view.result.current.collapsiblePanelProps.id;
      report(1000, 25);
      resize(1000, 40);

      expect(storage.getItem(SIZE_KEY)).toBe('400px');
      for (const [key, value] of storage.map) {
        expect(key).not.toContain(generationId);
        expect(value).not.toContain(generationId);
      }
    });
  });

  describe('clamp guard', () => {
    it('re-derives the panel when the group grows while it is short of its persisted size', () => {
      const { view, report } = setup({ stored: '400px' });

      report(1000, 30); // opened clamped at 300px
      report(1200, 25); // grew; the library kept the clamped 300px

      expect(view.result.current.collapsiblePanelProps.id).not.toBe('side');
      expect(view.result.current.collapsiblePanelProps.defaultSize).toBe('400px');
    });

    it('does not re-derive on a shrink, or once the panel is back at its persisted size', () => {
      const { view, report } = setup({ stored: '300px' });

      report(1000, 30);
      report(800, 30); // shrank and clamped to 240px: the library already fits it
      report(1500, 20); // grew while at the persisted 300px

      expect(view.result.current.collapsiblePanelProps.id).toBe('side');
    });
  });

  describe('restored size', () => {
    it('restores the persisted pixel size and keeps it on group resizes', () => {
      const { view } = setup({ stored: '320px' });

      expect(view.result.current.collapsiblePanelProps.defaultSize).toBe('320px');
      expect(view.result.current.collapsiblePanelProps.groupResizeBehavior).toBe(
        'preserve-pixel-size'
      );
    });

    it('falls back to the percentage layout older builds persisted', () => {
      const { view } = setup({ legacy: JSON.stringify({ main: 75, side: 25 }) });

      expect(view.result.current.collapsiblePanelProps.defaultSize).toBe('25%');
    });

    it('ignores malformed persisted values', () => {
      const { view } = setup({ stored: 'wide', legacy: 'not json' });

      expect(view.result.current.collapsiblePanelProps.defaultSize).toBeUndefined();
    });

    it('leaves the first size to the consumer when nothing is persisted', () => {
      const { view } = setup();

      expect(view.result.current.collapsiblePanelProps.defaultSize).toBeUndefined();
    });
  });
});

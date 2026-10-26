'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Layout, Orientation } from 'react-resizable-panels';

/**
 * Storage adapter for panel-layout persistence. Fully synchronous: the
 * binding and `useDefaultLayout` (through `useSyncExternalStore`) read
 * `getItem` on every render, so implementations must be fast and return
 * value-stable strings for unchanged values. The app injects its
 * memento-backed facade here.
 */
export type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface CollapsiblePanelBindingOptions {
  /** Unique persistence id for this group's layout. */
  storageKey: string;
  /** Storage adapter (the app passes its memento facade). */
  storage: LayoutStorage;
  /** All panel ids rendered when the collapsible panel is open, in order. */
  panelIds: string[];
  /** Id of the panel that opens/closes. */
  collapsiblePanelId: string;
  /** Group orientation; the binding passes it on to the `Resizable.Group`. */
  orientation: Orientation;
  /** Semantic open flag from the state store. */
  open: boolean;
  /** Semantic close command; called when a user drag settles below `closeThreshold`. */
  onCloseRequest: () => void;
  /** Size (percent of group, 0..100) below which a settled drag closes. Default 8. */
  closeThreshold?: number;
}

export interface CollapsiblePanelBinding {
  /** Spread onto the `Resizable.Group`. */
  groupProps: {
    orientation: Orientation;
    elementRef: RefObject<HTMLDivElement | null>;
    onLayoutChanged: (layout: Layout) => void;
  };
  /**
   * Spread onto the collapsible `Resizable.Panel` — including `id`, which the
   * binding owns (it is generation-suffixed per mount; see the guard comment
   * inside the hook).
   */
  collapsiblePanelProps: {
    id: string;
    defaultSize: string | undefined;
    groupResizeBehavior: 'preserve-pixel-size';
  };
}

/**
 * Binds a semantic open/closed flag to a collapsible react-resizable-panels
 * panel under the "never program the panels" contract:
 *
 * 1. Visibility is store-driven conditional rendering — the consumer mounts
 *    the panel (and its handle) only while `open`; the hook makes no
 *    imperative collapse/expand/resize/setLayout calls.
 * 2. Live pixel sizes belong to the library. The panel's persisted size is
 *    the width (or height) in pixels the user resized it to: window resizes
 *    go to the other panels (`preserve-pixel-size`), are never persisted, and
 *    never close the panel. Every mount restores the persisted pixels.
 * 3. The single semantic/pixel crossing point is drag-to-close: a user
 *    resize that settles below `closeThreshold` issues `onCloseRequest`
 *    (which unmounts the panel). Sizes in, commands out — sizes are never
 *    stored in app state.
 *
 * The hook also encapsulates the non-obvious library traps (verified against
 * react-resizable-panels v4.11) so no call site rediscovers them; see the
 * generation-id, user-input, sliver, and clamp guard comments below.
 */
export function useCollapsiblePanelBinding(
  options: CollapsiblePanelBindingOptions
): CollapsiblePanelBinding {
  const {
    storageKey,
    storage,
    panelIds,
    collapsiblePanelId,
    orientation,
    open,
    onCloseRequest,
    closeThreshold = 8,
  } = options;

  // GENERATION-ID GUARD ("poisoned panel memory"): when a panel unmounts and
  // later re-enters a still-mounted group under the SAME id, the library
  // restores it from its own in-memory registry for that id and IGNORES the
  // panel's `defaultSize`. That memory is stale: after a drag-to-close it
  // holds the sub-threshold sliver (a naive reopen re-closes instantly), and
  // after a window resize while closed it holds a percentage of the old
  // window. Fix, within the "never program the panels" contract: bump a
  // generation suffix on the panel id on every close, so each mount is a
  // brand-new identity to the library and its `defaultSize` (the persisted
  // pixel size) is honored. The suffix never reaches storage.
  const [generation, setGeneration] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setGeneration((g) => g + 1);
  }
  const generationId =
    generation === 0 ? collapsiblePanelId : `${collapsiblePanelId}@${generation}`;

  const sizeKey = `collapsible-panel-size:${storageKey}:${collapsiblePanelId}`;
  const persist = (px: number) => {
    const value = `${Math.round(px)}px`;
    if (storage.getItem(sizeKey) !== value) storage.setItem(sizeKey, value);
  };

  const groupRef = useRef<HTMLDivElement | null>(null);
  // Panel set and group size at the last reported layout: a changed panel set
  // is a (re)registration; the size tells a growing group from a shrinking one.
  const lastLayoutRef = useRef<{ panelKey: string; groupSize: number } | null>(null);

  // USER-INPUT GUARD: the library reports a user resize synchronously while
  // it dispatches the input event behind it (a drag ends on pointerup, or on
  // a pointermove with no button pressed; keyboard resizes on keydown; a
  // separator double-click resets on dblclick). Group resizes come from its
  // ResizeObserver, which never runs inside an event dispatch. So a layout
  // reported while the last of these events is still being dispatched is a
  // user resize, and nothing else is — no inference from measured sizes,
  // which cannot tell a drag from a sub-pixel window resize.
  const inputEventRef = useRef<Event | null>(null);
  useEffect(() => {
    const view = groupRef.current?.ownerDocument.defaultView ?? window;
    const record = (event: Event) => {
      inputEventRef.current = event;
    };
    for (const type of USER_RESIZE_EVENTS) view.addEventListener(type, record, true);
    return () => {
      for (const type of USER_RESIZE_EVENTS) view.removeEventListener(type, record, true);
    };
  }, []);

  const onLayoutChanged = (layout: Layout) => {
    const panelKey = Object.keys(layout).join(',');
    const groupSize = measureGroupSize(groupRef.current, orientation);
    const previous = lastLayoutRef.current;
    lastLayoutRef.current = { panelKey, groupSize };

    const size = layout[generationId];
    // SLIVER GUARD, part 1: onLayoutChanged also fires on mount and on panel
    // enter/leave reflows — a layout settling while closed is the unmount
    // reflow (only the filler panel remains). Never persist it.
    if (!open || size === undefined || groupSize <= 0) return;
    const px = (size / 100) * groupSize;
    // Read at event time, not render time: persisting re-renders nothing.
    const storedSize = readStoredSize(storage, sizeKey);

    if (previous?.panelKey !== panelKey) {
      // A (re)registration: the library just laid the panel out from its
      // `defaultSize`, which is the persisted size, clamped to what the group
      // fits. Not a user resize: never close, and never overwrite the
      // persisted size with a clamped one. With nothing persisted yet (first
      // run, or a percentage persisted by older builds), adopt the size the
      // panel opened at so later windows keep it in pixels.
      if (storedSize === undefined && size >= closeThreshold) persist(px);
      return;
    }

    const inputEvent = inputEventRef.current;
    if (inputEvent === null || inputEvent.eventPhase === Event.NONE) {
      // A group resize (the window, or a tiling WM, resized the app). The
      // library kept the panel's pixel size unless a constraint (a percentage
      // max, the other panels' minimums) clamped it to fit. Never persist or
      // close here: a clamp is not the user's new size.
      //
      // CLAMP GUARD: the library resizes from the clamped size, so a clamped
      // panel would stay small after the group grows back. When the group
      // grows and the panel is short of its persisted size, bump the
      // generation: the re-registered panel is laid out from `defaultSize`
      // again, i.e. the persisted size clamped to the new group.
      if (storedSize !== undefined && groupSize > previous.groupSize && px < storedSize - 1) {
        setGeneration((g) => g + 1);
      }
      return;
    }

    // A user resize: pointer drag, keyboard, or separator double-click.
    if (size < closeThreshold) {
      // THE one semantic/pixel crossing point: a user drag settled below the
      // close threshold. Issue the semantic command (unmounts the panel) and
      // — SLIVER GUARD, part 2 — deliberately do NOT persist the
      // sub-threshold size, otherwise the next open would restore a sliver.
      onCloseRequest();
      return;
    }
    persist(px);
  };

  return {
    groupProps: { orientation, elementRef: groupRef, onLayoutChanged },
    collapsiblePanelProps: {
      id: generationId,
      defaultSize: readDefaultSize(storage, sizeKey, storageKey, panelIds, collapsiblePanelId),
      groupResizeBehavior: 'preserve-pixel-size',
    },
  };
}

/**
 * The persisted pixel size, as a panel `defaultSize`. Falls back to the
 * percentage layout older builds persisted (the `useDefaultLayout` entry for
 * the open panel combination), so upgrading keeps the size the user had; the
 * first mount then persists it in pixels.
 */
function readDefaultSize(
  storage: LayoutStorage,
  sizeKey: string,
  storageKey: string,
  panelIds: string[],
  collapsiblePanelId: string
): string | undefined {
  const px = readStoredSize(storage, sizeKey);
  if (px !== undefined) return `${px}px`;
  const percent = readLegacyPercent(storage, storageKey, panelIds, collapsiblePanelId);
  // Layout values are percentages; bare numbers mean pixels to the panel prop
  // parser, so serialize with an explicit '%'.
  return percent !== undefined ? `${percent}%` : undefined;
}

function readStoredSize(storage: LayoutStorage, key: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(storage.getItem(key) ?? '');
  return match ? Number(match[1]) : undefined;
}

function readLegacyPercent(
  storage: LayoutStorage,
  storageKey: string,
  panelIds: string[],
  collapsiblePanelId: string
): number | undefined {
  const raw = storage.getItem(`react-resizable-panels:${[storageKey, ...panelIds].join(':')}`);
  if (raw === null) return undefined;
  try {
    const size: unknown = (JSON.parse(raw) as Record<string, unknown>)[collapsiblePanelId];
    return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}

const USER_RESIZE_EVENTS = ['pointerup', 'pointermove', 'keydown', 'dblclick'] as const;

/**
 * The space the group's panels share, separators excluded: the sum of their
 * rendered (fractional) sizes. Layout percentages are shares of it, so a
 * percentage times this is the panel's rendered pixel size, however a drag
 * splits the space. (Summing rounded `offsetWidth`s instead would not do:
 * at fractional widths that total depends on the split.)
 */
function measureGroupSize(group: HTMLElement | null, orientation: Orientation): number {
  let size = 0;
  for (const child of group?.children ?? []) {
    if (!(child instanceof HTMLElement) || !child.hasAttribute('data-panel')) continue;
    const rect = child.getBoundingClientRect();
    size += orientation === 'horizontal' ? rect.width : rect.height;
  }
  return size;
}

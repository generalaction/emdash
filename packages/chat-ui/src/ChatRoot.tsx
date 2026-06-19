/**
 * ChatRoot — the single Solid root for the chat transcript renderer.
 *
 * Reactive flow:
 *   transcriptStore.state → itemCount/getItem → visibleIndexes → <For> → Row
 *                                                          ↑
 *   scrollTop signal + viewHeight signal ──────────────────┤
 *                                                          ↓
 *   Row → createMemo(measure) → createEffect(virt.setSize) → setTotalHeight
 *   totalHeight signal → canvas height + row top positions
 *
 * Changes from the old architecture:
 *   - Accepts `theme?: ChatTheme` instead of `fonts?: FontConfig`.
 *   - Provides ThemeContext so all descendant Render components can access
 *     geometry constants without CSS var lookups.
 *   - Drops `chatCssVars()` writes — all geometry is projected via inline styles.
 *   - Drops `clearMessageLayoutCache` — invalidation is via node memo fingerprint.
 *   - Drops `ROW_REGISTRY` import in favour of the unified `REGISTRY`.
 *   - Accepts `commands` / `onReachStart` / `onAtBottomChange` / `controls`
 *     for command callbacks, pagination events, and imperative scroll.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  useContext,
} from 'solid-js';
import { CachesContext } from './components/CachesContext';
import { CommandsContext } from './components/CommandsContext';
import { DebugContext } from './components/debug-context';
import { PinnedUserMessage } from './components/PinnedUserMessage';
import { ThemeContext } from './components/ThemeContext';
import { SEGMENTERS, UNIT_REGISTRY } from './components/unit-registry';
import { UnitRow } from './components/UnitRow';
import { createChatCaches } from './core/caches';
import type { MeasureCtx } from './core/define';
import type { ChatHighlighter } from './core/highlight/highlighter';
import { genericEstimate } from './core/layout/generic-estimate';
import { registerFontsReadyClear } from './core/measure/pretext-cache';
import { ROW_GAP } from './core/metrics';
import { StickToBottom } from './core/stick-to-bottom';
import type { ChatTheme } from './core/theme';
import { DEFAULT_THEME } from './core/theme';
import { unitReservedHeight } from './core/units';
import { Virtualizer } from './core/virtualizer';
import type { ChatCommands, ScrollToItemOptions } from './index';
import type { ChatItem, ChatMessage } from './model';
import { flatten, collectUserTurnUnits, getUnit } from './state/flatten';
import type { TranscriptApi } from './state/transcript';
import type { ViewState } from './state/view-state';
import './chat.module.css';

// Centered content column. The scroll container stays full width (so the
// scrollbar sits at the viewport edge) while rows are measured and laid out
// against this capped, centered canvas — matching the desktop composer width.
const DEFAULT_CONTENT_CLASS = 'mx-auto w-full max-w-2xl';

// Symmetric overscan used when idle or velocity unknown
const OVERSCAN_BASE = 4;
// Leading buffer in the direction of scroll; trailing buffer behind it
const OVERSCAN_LEADING = 12;
const OVERSCAN_TRAILING = 3;

// Idle-time prefetch: how many rows beyond the overscan window to pre-measure
// during requestIdleCallback slices. Rows ahead in scroll direction get a
// larger budget; behind get a smaller one.
const PREFETCH_AHEAD = 30;
const PREFETCH_BEHIND = 10;
// Stop the current idle slice if less than this many ms remain (leaves headroom
// for the browser's own idle tasks).
const PREFETCH_MIN_REMAINING_MS = 3;

// onReachStart fires when the top row is visible and scrollTop is within this
// threshold of the canvas top. Debounced: only fires once until reset.
const REACH_START_THRESHOLD_PX = 200;

// ── EngineControls ────────────────────────────────────────────────────────────

/**
 * Mutable holder populated by ChatRoot.onMount. mountChat creates an instance
 * and passes it to ChatRoot; the handle methods delegate to it so callers
 * never hold stale closures.
 */
export type EngineControls = {
  scrollToBottom(opts?: { behavior?: ScrollBehavior }): void;
  scrollToItem(id: string, opts?: ScrollToItemOptions): void;
  loadOlder(items: ChatItem[]): void;
};

// ── ChatRootProps ─────────────────────────────────────────────────────────────

export type ChatRootProps = {
  transcript: TranscriptApi;
  viewState: ViewState;
  /** Full theme (fonts + geometry). Replaces the old `fonts` option. */
  theme?: ChatTheme;
  stickToBottom?: boolean;
  /** Extra classes for the full-width scroll container. */
  class?: string;
  /**
   * Classes for the centered content column. Defaults to a max-width column.
   * Rows are measured against this element's width, not the scroll container.
   */
  contentClass?: string;
  /**
   * Enable the layout-boundary debug overlay on every block and row. When
   * omitted, an ambient DebugContext (e.g. the Storybook toolbar) is inherited.
   */
  debug?: boolean;
  /**
   * Vertical padding reserved at the top of the canvas (px). Baked into the
   * virtualizer coordinate space — not CSS padding — so scroll math stays exact.
   * Accepts a static number or a reactive accessor so mountChat can pass a signal.
   */
  padTop?: number | (() => number);
  /**
   * Vertical padding reserved at the bottom of the canvas (px). The last row
   * rests above this space, keeping content clear of a floating composer.
   * Accepts a static number or a reactive accessor so mountChat can pass a signal.
   */
  padBottom?: number | (() => number);
  /**
   * Reactive accessor returning the current ChatCommands. Provided by mountChat
   * via a signal so setCommands can update them without remounting.
   */
  commands?: () => ChatCommands;
  /** Fired when the user scrolls near the top and the engine has run out of history. */
  onReachStart?: () => void;
  /** Fired when the "at bottom" sticky state changes. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * Mutable holder that ChatRoot.onMount populates with imperative scroll
   * methods. mountChat passes its own holder so handle methods delegate here.
   */
  controls?: EngineControls;
  /**
   * Optional syntax-highlighting adapter. When omitted the bundled default
   * (em-light/em-dark themes, common languages) is used. Inject an
   * app-singleton highlighter from emdash-desktop for the full language set
   * and exact design-system syntax colors.
   */
  highlighter?: ChatHighlighter;
  /**
   * When true, the active turn's user message is pinned to the top of the
   * transcript while scrolling, with a push-up transition as the next user
   * message enters the viewport. Defaults to false (no behavior change for
   * existing consumers).
   */
  pinUserMessages?: boolean;
};

// ── ChatRoot ──────────────────────────────────────────────────────────────────

export function ChatRoot(props: ChatRootProps) {
  const caches = createChatCaches(props.highlighter);
  const theme = () => props.theme ?? DEFAULT_THEME;
  const contentClass = () => props.contentClass ?? DEFAULT_CONTENT_CLASS;
  const commands = () => props.commands?.() ?? {};

  const padTop = () => {
    const v = props.padTop;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };
  const padBottom = () => {
    const v = props.padBottom;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };

  const inheritedDebug = useContext(DebugContext);
  const debugValue = () => props.debug ?? inheritedDebug();

  let scrollEl: HTMLDivElement | undefined;
  let canvasEl: HTMLDivElement | undefined;
  const virt = new Virtualizer();
  let sticky: StickToBottom | null = null;

  const [totalHeight, setTotalHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollVelocity, setScrollVelocity] = createSignal(0);
  const [viewHeight, setViewHeight] = createSignal(600);
  const [containerWidth, setContainerWidth] = createSignal(0);
  // Monotonically-increasing counter bumped after fonts load. Including this in
  // blockMemo fingerprints forces a cache miss even when theme.version and width
  // are unchanged, clearing any fallback-font geometry that was measured before
  // Inter/JetBrains loaded.
  const [measureEpoch, setMeasureEpoch] = createSignal(0);

  const refreshTotal = () => {
    setTotalHeight(virt.total());
  };

  // ── Flat unit array ───────────────────────────────────────────────────────
  //
  // Recomputed when the transcript state changes (committed tier grows or
  // activeTurn mutates). The segment cache in flatten.ts makes re-runs O(activeTurn)
  // for committed items. Unit ids are stable across streaming ticks for committed
  // items so the <For> keeps existing UnitRow instances mounted.

  const segmentCtx = createMemo(() => ({
    caches,
    expanded: (_id: string) => false, // collapse state queried per-unit in UnitRow
  }));

  const units = createMemo(() => flatten(props.transcript.state, segmentCtx(), SEGMENTERS));

  // ── Count sync effect ─────────────────────────────────────────────────────
  //
  // Now driven by the flat units array instead of itemCount/getItem.
  // The estimate path mirrors the old logic: for legacy units (Phase 0, all
  // units), unit.data is the ChatItem, so we look up REGISTRY as before.
  // For native units (Phase 1+), UNIT_REGISTRY is consulted.

  createEffect(() => {
    const us = units();
    const t = theme();
    untrack(() => {
      const estimateCtx = {
        theme: t,
        width: 0,
        isCollapsed: () => false,
        expanded: () => false,
        caches,
        measureEpoch: measureEpoch(),
      };
      virt.setCount(us.length, (i) => {
        const u = us[i];
        if (!u) return 60;
        const unitDef = UNIT_REGISTRY[u.kind];
        const contentH =
          unitDef?.estimate?.(u.data, estimateCtx) ??
          genericEstimate(u.data as unknown as ChatItem, estimateCtx);
        return unitReservedHeight(u, contentH);
      });
      refreshTotal();
      if (props.stickToBottom !== false) sticky?.schedule();
    });
  });

  // ── Width change: flush text-measurement cache ───────────────────────────

  createEffect(() => {
    const w = containerWidth();
    if (w <= 0) return;
    caches.clearTextMeasure();
    // Node memo in registry is fingerprint-keyed (includes width) so it
    // self-invalidates on width change — no explicit cache clear needed.
  });

  // ── Visible range — direction-aware asymmetric overscan ───────────────────

  const visibleRange = createMemo(() => {
    totalHeight();
    const v = scrollVelocity();
    let before: number;
    let after: number;
    if (v > 0) {
      before = OVERSCAN_TRAILING;
      after = OVERSCAN_LEADING;
    } else if (v < 0) {
      before = OVERSCAN_LEADING;
      after = OVERSCAN_TRAILING;
    } else {
      before = OVERSCAN_BASE;
      after = OVERSCAN_BASE;
    }
    return virt.range(Math.max(0, scrollTop() - padTop()), viewHeight(), before, after);
  });

  const visibleIndexes = createMemo(() => {
    totalHeight();
    const n = units().length;
    const { start, end } = visibleRange();
    const visEnd = Math.min(end, n - 1);
    const arr: number[] = [];
    for (let i = start; i <= visEnd; i++) {
      arr.push(i);
    }
    return arr;
  });

  // ── Pinned user-message overlay ───────────────────────────────────────────

  // Absolute unit indices of the first unit of each committed user-message group.
  // Recomputed when committed tier grows or units changes (turn appended / message split).
  const userTurns = createMemo(() => collectUserTurnUnits(props.transcript.state, units()));

  // The active pin state: which user message to overlay, and its overlayTop.
  //
  // The overlay lives OUTSIDE the scroll container (in a non-scrolling wrapper),
  // so it does not move with native scroll and `overlayTop` is a viewport-
  // relative offset — NOT a canvas-Y coordinate. `overlayTop` is the top of the
  // background CONTAINER (which carries a ROW_GAP top padding so the message sits
  // 8px down while the strip above it is filled, hiding rows behind it). In
  // steady state it is 0 (container flush to the viewport top); during the
  // handoff it rides up as the next user row approaches. Because the steady-state
  // value is a constant 0, normal scrolling produces no per-frame transform
  // change, so the overlay never jitters (only the brief push-up window touches
  // scrollTop()).
  //
  // Depends on scrollTop(), padTop(), totalHeight() (for virt.top/virt.size
  // accuracy after streaming height changes), and userTurns() (on turn append).
  //
  // Returns null when pinUserMessages is false or no active turn exists.
  const pinState = createMemo(() => {
    if (!props.pinUserMessages) return null;
    const turns = userTurns();
    if (turns.length === 0) return null;

    const st = scrollTop();
    const pt = padTop();
    totalHeight(); // track streaming height changes so virt.top/virt.size stay accurate

    // The message content pin line sits ROW_GAP below the viewport top (the
    // container's top padding), so the pinned message keeps the same 8px gap to
    // the top edge that rows have between each other.
    const pinLine = ROW_GAP;

    // Binary search: largest turns[i] whose real row content has scrolled above
    // the pin line, i.e. (virt.top(turns[i]) + pt) - st < pinLine.
    let lo = 0;
    let hi = turns.length - 1;
    let activePos = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (virt.top(turns[mid]) + pt < st + pinLine) {
        activePos = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (activePos < 0) return null; // no user message has scrolled above the pin line

    const activeUserIdx = turns[activePos]; // unit index
    const nextUserIdx = turns[activePos + 1]; // unit index; undefined when last turn
    // Sum the heights of all units in the active user's group for the overlay height.
    // For Phase 0 this is always exactly one unit; Phase 1 sums per-block units.
    let overlayH = 0;
    const activeUnit = getUnit(units(), activeUserIdx);
    if (activeUnit) {
      const activeItemId = activeUnit.itemId;
      for (let ui = activeUserIdx; ui < units().length; ui++) {
        const u = getUnit(units(), ui);
        if (!u || u.itemId !== activeItemId) break;
        overlayH += virt.size(ui);
      }
    }

    // Viewport-relative top of the next user row (Infinity when none).
    const nextUserViewportTop =
      nextUserIdx !== undefined ? virt.top(nextUserIdx) + pt - st : Infinity;
    // Container top. Steady state: 0 (container flush to the viewport top, its
    // ROW_GAP top padding placing the message at the pin line). Handoff: rides up
    // so the container bottom meets the incoming row's top, continuous with the
    // real row arriving at the pin line exactly when the active index advances.
    const overlayTop = Math.min(0, nextUserViewportTop - overlayH - pinLine);

    return { activeUserIdx, overlayTop };
  });

  // ── Row top positions ─────────────────────────────────────────────────────

  let programmaticScroll = false;

  const onHeightChanged = (index: number, delta: number) => {
    refreshTotal();
    if (delta === 0) return;

    if (props.stickToBottom !== false && sticky?.isStuck()) {
      sticky.schedule();
      return;
    }

    if (virt.top(index) + padTop() < scrollEl!.scrollTop) {
      const next = scrollEl!.scrollTop + delta;
      programmaticScroll = true;
      scrollEl!.scrollTop = next;
      setScrollTop(next);
    }
  };

  // ── Scroll helpers ────────────────────────────────────────────────────────

  const doScrollToBottom = (opts?: { behavior?: ScrollBehavior }) => {
    const el = scrollEl;
    if (!el) return;
    if (opts?.behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight - el.clientHeight, behavior: 'smooth' });
    } else if (sticky) {
      sticky.scrollToBottom();
    } else {
      el.scrollTo({ top: el.scrollHeight - el.clientHeight });
    }
  };

  const doScrollToItem = (id: string, opts?: ScrollToItemOptions) => {
    const el = scrollEl;
    if (!el) return;

    // Map from itemId to the first unit index for that item.
    const us = units();
    let unitIdx = -1;
    for (let i = 0; i < us.length; i++) {
      if (us[i].itemId === id) {
        unitIdx = i;
        break;
      }
    }
    if (unitIdx < 0) return;

    // Compute the total height of all units belonging to this item (for center/end align).
    let itemTotalH = 0;
    for (let i = unitIdx; i < us.length; i++) {
      if (us[i].itemId !== id) break;
      itemTotalH += virt.size(i);
    }

    const idx = unitIdx;
    const rowH = itemTotalH;

    const align = opts?.align ?? 'start';
    const extraOffset = opts?.offset ?? 0;
    const behavior = opts?.behavior ?? 'auto';

    const computeTarget = () => {
      const rowTop = virt.top(idx) + padTop();
      const vh = el.clientHeight;
      let target: number;
      if (align === 'center') {
        target = rowTop - (vh - rowH) / 2;
      } else if (align === 'end') {
        target = rowTop - vh + rowH;
      } else {
        target = rowTop;
      }
      return Math.max(0, target + extraOffset);
    };

    el.scrollTo({ top: computeTarget(), behavior });

    // Settle pass: after one rAF the row may have measured; re-read its top.
    if (behavior !== 'smooth') {
      programmaticScroll = true;
      requestAnimationFrame(() => {
        programmaticScroll = false;
        el.scrollTo({ top: computeTarget(), behavior: 'auto' });
      });
    }
  };

  const doLoadOlder = (items: Parameters<typeof props.transcript.prependHistory>[0]) => {
    const el = scrollEl;
    if (!el || items.length === 0) return;

    const t = theme();

    // Capture anchor: the first visible unit index and its offset from scrollTop.
    const anchorUnitIdx = virt.findIndex(Math.max(0, el.scrollTop - padTop()));
    const anchorId = getUnit(units(), anchorUnitIdx)?.itemId;
    const anchorOffset = el.scrollTop - (virt.top(anchorUnitIdx) + padTop());

    // Estimate heights for the prepended units.
    // Since we don't have the segmented units yet (transcript not yet updated),
    // we estimate one unit per item using the item-level estimate.
    const loadEstimateCtx: MeasureCtx = {
      theme: t,
      width: containerWidth(),
      isCollapsed: () => false,
      expanded: () => false,
      caches,
    };
    const count = items.length;
    virt.prepend(count, (i) => {
      const item = items[i];
      if (!item) return ROW_GAP + 60;
      const unitDef = UNIT_REGISTRY[item.kind];
      const contentH =
        unitDef?.estimate?.(item, loadEstimateCtx) ?? genericEstimate(item, loadEstimateCtx);
      // Solo unit estimate (no chrome padY for composites; user messages have padY handled)
      return ROW_GAP + contentH;
    });

    // Update the transcript store (triggers the count-sync effect and re-flattens).
    props.transcript.prependHistory(items);
    refreshTotal();

    // Restore scroll position so the previously-visible unit stays in view.
    if (anchorId !== undefined) {
      // Find the new unit index for the anchor item after prepend.
      const newUs = units();
      let newUnitIdx = -1;
      for (let i = 0; i < newUs.length; i++) {
        if (newUs[i].itemId === anchorId) {
          newUnitIdx = i;
          break;
        }
      }
      if (newUnitIdx >= 0) {
        const newTop = virt.top(newUnitIdx) + padTop() + anchorOffset;
        programmaticScroll = true;
        el.scrollTop = newTop;
        setScrollTop(newTop);
      }
    }
  };

  // ── DOM setup ─────────────────────────────────────────────────────────────

  onMount(() => {
    const el = scrollEl!;

    sticky = new StickToBottom(el);

    // Populate the controls holder so handle delegates resolve immediately.
    if (props.controls) {
      props.controls.scrollToBottom = doScrollToBottom;
      props.controls.scrollToItem = doScrollToItem;
      props.controls.loadOlder = doLoadOlder;
    }

    // CSS vars required by CSS modules. Set once on mount (theme is not reactive
    // in the current architecture; if theme changes, a full unmount/remount is
    // expected). Groups:
    //   Typography — feed pretext measurement; keep until CSS modules migrate to --type-* vars.
    //   Inline code / mention chrome — feed pretext extra-width accounting.
    //   Code block geometry — feed Code.tsx visual chrome (padding, border).
    //   Island geometry — caps the max-height of fixed-size island blocks.
    const t = theme();
    const d = t.density;
    // Extract font-size px value from CSS shorthand "weight size family".
    const codeSizePx = t.fonts.code.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '13';
    const cssVars: Record<string, string> = {
      // Typography (--type-code-* equivalents that CSS modules reference as --chat-code-*)
      '--chat-code-size': `${codeSizePx}px`,
      '--chat-code-lh': `${t.fonts.code.lineHeight}px`,
      '--chat-code-weight': '400',
      // Inline code / mention chrome (feed pretext extra-width accounting)
      '--chat-ic-pad-x': `${d.inlineCodePadX}px`,
      '--chat-ic-pad-y': `${d.inlineCodePadY}px`,
      '--chat-mention-pad-x': `${Math.round(t.fonts.mentionExtraWidth / 2)}px`,
      // Code block geometry (visual chrome — border, padding; matches code.def.tsx constants)
      '--chat-code-border': '1px',
      '--chat-code-pad-x': '8px',
      '--chat-code-pad-y': '8px',
    };
    for (const [k, v] of Object.entries(cssVars)) {
      el.style.setProperty(k, v);
    }

    let rafId: number | null = null;
    let lastScrollTop = 0;
    let atBottom = sticky.isStuck();
    let reachStartFired = false;

    const flushScroll = () => {
      rafId = null;
      const st = el.scrollTop;
      setScrollVelocity(st - lastScrollTop);
      lastScrollTop = st;
      setScrollTop(st);

      // onAtBottomChange
      const nowAtBottom = sticky!.isStuck();
      if (nowAtBottom !== atBottom) {
        atBottom = nowAtBottom;
        props.onAtBottomChange?.(atBottom);
      }

      // onReachStart — fire once when near the top; reset when user scrolls away
      if (st <= REACH_START_THRESHOLD_PX) {
        if (!reachStartFired) {
          reachStartFired = true;
          props.onReachStart?.();
        }
      } else {
        reachStartFired = false;
      }

      // Arm idle prefetch after scroll settles.
      schedulePrefetch();
    };

    // ── Idle-time prefetch scheduler ────────────────────────────────────────────
    //
    // After each scroll settle (no new scroll event fires before the rAF callback
    // flushes) we schedule a requestIdleCallback to pre-measure rows just beyond
    // the overscan window. This populates the shared nodeMemo WeakMap so those
    // rows are cache hits when they later scroll into view, converting ~1500x
    // cold-vs-warm measure cost into background idle work.
    //
    // Cancellation / rescheduling:
    //   - Cancelled immediately when a new scroll event fires (so it never
    //     competes with active scrolling).
    //   - Re-scheduled after each flushScroll (settle).
    //   - Per-slice budget: stop if deadline.timeRemaining() < PREFETCH_MIN_REMAINING_MS.
    //   - Reschedules itself if work remains within the current window.
    //
    // Falls back to setTimeout(fn, 0) when requestIdleCallback is unavailable.

    let prefetchIdleId: ReturnType<typeof requestIdleCallback> | null = null;

    // Index cursor: prefetcher tracks where it left off so each slice continues
    // from the previous boundary without re-scanning already-warm rows.
    let prefetchStart = -1;
    let prefetchEnd = -1;

    const schedulePrefetch = () => {
      if (prefetchIdleId !== null) return;
      prefetchIdleId = requestIdleCallback(runPrefetchSlice, { timeout: 500 });
    };

    const cancelPrefetch = () => {
      if (prefetchIdleId !== null) {
        cancelIdleCallback(prefetchIdleId);
        prefetchIdleId = null;
      }
    };

    const runPrefetchSlice = (deadline: IdleDeadline) => {
      prefetchIdleId = null;

      const { start: visStart, end: visEnd } = visibleRange();
      const us = units();
      const n = us.length;
      if (n === 0) return;

      // Determine the window to prefetch: units beyond the current visible+overscan
      // range, ahead in scroll direction + a shorter tail behind.
      const ahead = Math.min(visEnd + PREFETCH_AHEAD, n - 1);
      const behind = Math.max(visStart - PREFETCH_BEHIND, 0);

      // Initialise cursor on first call after a settle.
      if (prefetchStart < 0 || prefetchEnd < 0) {
        prefetchStart = visEnd + 1;
        prefetchEnd = ahead;
      }

      const w = containerWidth();
      const t = theme();

      let measured = 0;

      // Helper: prefetch one unit at absolute index ui.
      const prefetchUnit = (ui: number): void => {
        const u = us[ui];
        if (!u) return;
        const unitDef = UNIT_REGISTRY[u.kind];
        if (!unitDef) return;
        const c = u.chrome;
        const unitInsetX = c?.insetX ?? 0;
        const ctx: MeasureCtx = {
          theme: t,
          width: Math.max(0, w - 2 * unitInsetX),
          isCollapsed: (id: string) => props.viewState.isCollapsed(id),
          expanded: (id: string) => props.viewState.isCollapsed(id),
          caches,
          measureEpoch: measureEpoch(),
        };
        const contentH = unitDef.measure(u.data, ctx);
        const h = unitReservedHeight(u, contentH);
        const delta = virt.setSize(ui, h);
        if (delta !== 0) onHeightChanged(ui, delta);
      };

      // Forward pass: visEnd+1 .. ahead
      while (
        prefetchStart <= prefetchEnd &&
        deadline.timeRemaining() >= PREFETCH_MIN_REMAINING_MS
      ) {
        prefetchUnit(prefetchStart);
        measured++;
        prefetchStart++;
      }

      // Backward pass: behind .. visStart-1 (only when forward pass exhausted)
      if (prefetchStart > prefetchEnd) {
        let backCursor = visStart - 1;
        while (backCursor >= behind && deadline.timeRemaining() >= PREFETCH_MIN_REMAINING_MS) {
          prefetchUnit(backCursor);
          measured++;
          backCursor--;
        }
      }

      // Reschedule if work remains in the forward window.
      if (measured > 0 && prefetchStart <= prefetchEnd) {
        schedulePrefetch();
      }
    };

    const onScroll = () => {
      if (el.offsetParent === null) return;
      if (programmaticScroll) {
        programmaticScroll = false;
        return;
      }
      // Cancel any in-flight prefetch so it never competes with active scrolling.
      cancelPrefetch();
      // Reset cursor so the next settle re-targets the new viewport position.
      prefetchStart = -1;
      prefetchEnd = -1;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushScroll);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => {
      el.removeEventListener('scroll', onScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      cancelPrefetch();
    });

    const roHeight = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setViewHeight(h);
    });
    roHeight.observe(el);
    onCleanup(() => roHeight.disconnect());

    if (canvasEl) {
      const roWidth = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setContainerWidth(w);
      });
      roWidth.observe(canvasEl);
      onCleanup(() => roWidth.disconnect());
    }

    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-collapse-id]') as HTMLElement | null;
      if (target?.dataset.collapseId) {
        props.viewState.toggleCollapsed(target.dataset.collapseId);
      }
    };
    el.addEventListener('click', onClick);
    onCleanup(() => el.removeEventListener('click', onClick));

    registerFontsReadyClear(() => {
      caches.clearTextMeasure();
      // Bump epoch so blockMemo fingerprints mismatch on next measure,
      // clearing any fallback-font geometry cached before fonts loaded.
      setMeasureEpoch((e) => e + 1);
      refreshTotal();
    });

    if (props.stickToBottom !== false) {
      sticky?.scrollToBottom();
    }

    onCleanup(() => {
      sticky?.dispose();
      sticky = null;
    });

    onCleanup(() => caches.clear());
  });

  // ── Active-turn id set (hoisted) ──────────────────────────────────────────
  //
  // Computed once per transcript.state update and reused by every visible
  // UnitRow instead of being recreated inside each <For> iteration.
  const activeTurnItemIds = createMemo(() => {
    const active = props.transcript.state.activeTurn;
    if (!active) return new Set<string>();
    return new Set(active.map((i) => i.id));
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DebugContext.Provider value={debugValue}>
      <ThemeContext.Provider value={theme}>
        <CachesContext.Provider value={caches}>
          <CommandsContext.Provider value={commands}>
            {/* Non-scrolling positioned wrapper. Hosts the scroll container and
                the pinned overlay as siblings so the overlay is unaffected by
                native scroll (no per-frame counter-translation → no jitter).
                overflow-hidden clips the overlay as it rides up during handoff. */}
            <div class="relative h-full w-full overflow-hidden">
              <div
                ref={(el) => {
                  scrollEl = el;
                }}
                data-chat-scroll
                class={`relative h-full w-full overflow-x-hidden overflow-y-auto${props.class ? ` ${props.class}` : ''}`}
              >
                <div
                  ref={(el) => {
                    canvasEl = el;
                  }}
                  data-chat-canvas
                  class={`relative ${contentClass()}`}
                  style={{ height: `${totalHeight() + padTop() + padBottom()}px` }}
                >
                  <For each={visibleIndexes()}>
                    {(unitIndex) => {
                      const unitTop = createMemo(() => {
                        totalHeight();
                        return virt.top(unitIndex) + padTop();
                      });

                      const u = createMemo(() => getUnit(units(), unitIndex));
                      const isActiveTurn = () => {
                        const unit = u();
                        return unit ? activeTurnItemIds().has(unit.itemId) : false;
                      };

                      return (
                        <Show when={u()}>
                          <div
                            class="absolute top-0 left-0 w-full will-change-transform [contain:layout_paint_style]"
                            style={{ transform: `translateY(${unitTop()}px)` }}
                            data-index={String(unitIndex)}
                          >
                            <UnitRow
                              unit={u()!}
                              index={unitIndex}
                              rowWidth={containerWidth()}
                              theme={theme()}
                              viewState={props.viewState}
                              virt={virt}
                              onHeightChanged={onHeightChanged}
                              isActiveTurn={isActiveTurn()}
                              caches={caches}
                              measureEpoch={measureEpoch()}
                            />
                          </div>
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </div>
              {/* Pinned user-message overlay — sibling of the scroller, so it is
                  NOT moved by native scroll. `overlayTop` is a viewport-relative
                  offset (0 in steady state). Centered to the same content column
                  as the canvas via contentClass(). `aria-hidden` avoids double
                  screen-reader announcement; `pointer-events-none` lets clicks
                  fall through to the real virtualized row. */}
              <Show when={pinState()}>
                {(state) => (
                  <div
                    class={`pointer-events-none absolute inset-x-0 top-0 z-10 will-change-transform ${contentClass()}`}
                    aria-hidden="true"
                    style={{ transform: `translateY(${state().overlayTop}px)` }}
                  >
                    <PinnedUserMessage
                      item={
                        (() => {
                          const unit = getUnit(units(), state().activeUserIdx);
                          if (!unit) return undefined;
                          // Find the ChatMessage for this itemId in committed.
                          return props.transcript.state.committed.find(
                            (i) => i.id === unit.itemId
                          ) as ChatMessage | undefined;
                        })()!
                      }
                      rowWidth={containerWidth()}
                      theme={theme()}
                      caches={caches}
                    />
                  </div>
                )}
              </Show>
            </div>
          </CommandsContext.Provider>
        </CachesContext.Provider>
      </ThemeContext.Provider>
    </DebugContext.Provider>
  );
}

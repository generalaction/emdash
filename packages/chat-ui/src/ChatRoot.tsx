/**
 * ChatRoot — the Solid component that implements the chat transcript renderer.
 *
 * Architecture (ChatContext / ChatState / ChatView split):
 *   - ChatContext is passed as `props.context`: provides theme, shared caches,
 *     measureEpoch, and the Shiki highlighter.
 *   - ChatState is passed as `props.state`: provides transcript + parse caches.
 *   - ChatRoot owns view state: viewState (collapse), expandedUserId, scroll,
 *     virtualizer / heightmap, the hardened frame scheduler, and tween registry.
 *
 * Scheduler hardening (aligned with CodeMirror's measure cycle):
 *   - Created eagerly (before `onMount`) so tween arming never hits a null ref.
 *   - try/catch around phases; re-arm always executes in `finally`.
 *   - Visibility watchdog: `forceReconcile()` on visibilitychange and on attach.
 *
 * Width invalidation (A6 — per-row dirty via fingerprint):
 *   - clearTextMeasure() is NOT called on width change. The per-block fingerprint
 *     (measureEpoch|width|collapsed) already handles width invalidation.
 *   - prepareRichInline is width-independent (intrinsic glyph widths), so it
 *     is retained in SharedCaches without flushing on resize.
 *
 * Composer slot (A7):
 *   - When `composer === 'slot'`, ChatRoot renders a sticky bottom slot inside
 *     outerClip. An internal ResizeObserver drives `padBottom` automatically.
 *   - `controls.composerSlot` exposes the slot HTMLElement so the host can
 *     portal a React composer into it.
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
import type { ChatContext } from './chat-context';
import { CachesContext } from './components/contexts/CachesContext';
import { CommandsContext } from './components/contexts/CommandsContext';
import { DebugContext } from './components/contexts/debug-context';
import { ThemeContext } from './components/contexts/ThemeContext';
import { TurnStateContext } from './components/contexts/TurnStateContext';
import { createFrameScheduler } from './components/engine/frame-scheduler';
import { createTweenRegistry } from './components/engine/tween-registry';
import { SEGMENTERS, UNIT_REGISTRY } from './components/engine/unit-registry';
import { UnitRow } from './components/engine/UnitRow';
import { PinnedUserMessage } from './components/rows/message/PinnedUserMessage';
import type { ChatCaches } from './core/caches';
import type { ThemeVarKey } from './core/config';
import type { MeasureCtx } from './core/define';
import { genericEstimate } from './core/layout/generic-estimate';
import { STICK_THRESHOLD_PX } from './core/stick-to-bottom';
import { unitReservedHeight } from './core/units';
import { Virtualizer } from './core/virtualizer';
import type { ChatCommands, ScrollToItemOptions } from './index';
import type { ChatItem, ChatMessage } from './model';
import type { ChatState } from './state/chat-state';
import { flattenTier, makeUnitsView, collectUserTurnUnits } from './state/flatten';
import type { UnitsView } from './state/flatten';
import { createViewState } from './state/view-state';
import {
  canvas,
  composerSlotClass,
  defaultContentClass,
  outerClip,
  pinnedOverlay,
  scrollContainer,
  unitRowWrapper,
} from './chat-root.css';
import './chat-fonts.css';
import { vars } from './styles/theme.css';

// Centered content column. The scroll container stays full width (so the
// scrollbar sits at the viewport edge) while rows are measured and laid out
// against this capped, centered canvas — matching the desktop composer width.
const DEFAULT_CONTENT_CLASS = defaultContentClass;

// Symmetric overscan used when idle or velocity unknown
const OVERSCAN_BASE = 12;
// Leading buffer in the direction of scroll; trailing buffer behind it
const OVERSCAN_LEADING = 20;
const OVERSCAN_TRAILING = 8;

// Idle-time prefetch: how many rows beyond the overscan window to pre-measure
// during requestIdleCallback slices. Rows ahead in scroll direction get a
// larger budget; behind get a smaller one.
const PREFETCH_AHEAD = 40;
const PREFETCH_BEHIND = 20;
// Stop the current idle slice if less than this many ms remain (leaves headroom
// for the browser's own idle tasks).
const PREFETCH_MIN_REMAINING_MS = 3;

// onReachStart fires when the top row is visible and scrollTop is within this
// threshold of the canvas top. Debounced: only fires once until reset.
const REACH_START_THRESHOLD_PX = 200;

// ── EngineControls ────────────────────────────────────────────────────────────

/**
 * Mutable holder populated by ChatRoot.onMount. createChatView creates an
 * instance and passes it to ChatRoot; the ChatView handle methods delegate to
 * it so callers never hold stale closures.
 */
export type EngineControls = {
  scrollToBottom(opts?: { behavior?: ScrollBehavior }): void;
  scrollToItem(id: string, opts?: ScrollToItemOptions): void;
  loadOlder(items: ChatItem[]): void;
  /** Toggle collapse for an item by id (for view.toggleCollapsed). */
  toggleCollapsed?(id: string): void;
  /** Snapshot the expanded-user-id state (for view.saveState). */
  getExpandedUserId?(): string | null;
  /** Restore the expanded-user-id state (for view.restoreState). */
  setExpandedUserId?(id: string | null): void;
  /**
   * Reference to the composer slot element. Set by ChatRoot after mount when
   * `composer === 'slot'`. The host portals its React composer into this element.
   */
  composerSlot?: HTMLElement | null;
  /**
   * Called once at the end of ChatRoot's onMount, after all controls and
   * composerSlot are wired. Used by createChatView to fire onViewMounted.
   */
  onMounted?(): void;
};

// ── ChatRootProps ─────────────────────────────────────────────────────────────

export type ChatRootProps = {
  /** Global services: theme, shared caches, measureEpoch, highlighter. */
  context: ChatContext;
  /** Per-conversation state: transcript + parse caches. */
  state: ChatState;
  stickToBottom?: boolean;
  /** Extra classes for the full-width scroll container. */
  class?: string;
  /**
   * Classes for the centered content column. Defaults to a max-width column.
   * Rows are measured against this element's width, not the scroll container.
   */
  contentClass?: string;
  /**
   * Enable the layout-boundary debug overlay on every block and row.
   */
  debug?: boolean;
  /**
   * Vertical padding reserved at the top of the canvas (px). Baked into the
   * virtualizer coordinate space — not CSS padding — so scroll math stays exact.
   * Accepts a static number or a reactive accessor.
   */
  padTop?: number | (() => number);
  /**
   * Vertical padding reserved at the bottom of the canvas (px). The last row
   * rests above this space, keeping content clear of a floating composer.
   * When `composer === 'slot'` this is driven automatically by the slot's
   * ResizeObserver; pass a static value only for non-slot hosts.
   * Accepts a static number or a reactive accessor.
   */
  padBottom?: number | (() => number);
  /**
   * Reactive accessor returning the current ChatCommands. Provided by
   * createChatView via a signal so setCommands can update them without remounting.
   */
  commands?: () => ChatCommands;
  /** Fired when the user scrolls near the top and the engine has run out of history. */
  onReachStart?: () => void;
  /** Fired when the "at bottom" sticky state changes. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * Mutable holder that ChatRoot.onMount populates with imperative scroll
   * methods and the composer slot reference.
   */
  controls?: EngineControls;
  /**
   * When true, the active turn's user message is pinned to the top of the
   * transcript while scrolling. Defaults to false.
   */
  pinUserMessages?: boolean;
  /**
   * Controls whether ChatRoot renders an internal composer slot.
   * - `'slot'`: render a sticky bottom slot; internal ResizeObserver drives padBottom.
   * - `'none'` (default): no slot; host controls padBottom externally.
   */
  composer?: 'slot' | 'none';
};

// ── ChatRoot ──────────────────────────────────────────────────────────────────

export function ChatRoot(props: ChatRootProps) {
  // Assemble the full ChatCaches bundle from context (shared) + state (parse).
  // Leaf components (Code.tsx, Diff.tsx) consume this via useCaches().
  const caches: ChatCaches = {
    ...props.context.sharedCaches,
    ...props.state.parseCaches,
  };

  // Theme and CSS vars — set once at creation time. Color theme changes are
  // free (CSS-variable themed). Typography changes require bumping measureEpoch.
  const resolved = props.context.theme;
  const scrollElStyle = (() => {
    const tv = resolved.themeVars;
    const style: Record<string, string> = {};
    for (const k of Object.keys(tv) as ThemeVarKey[]) {
      const ref = String(vars[k as keyof typeof vars]);
      style[ref.startsWith('var(') ? ref.slice(4, -1) : ref] = tv[k];
    }
    return style;
  })();
  const theme = () => resolved;
  const contentClass = () => props.contentClass ?? DEFAULT_CONTENT_CLASS;
  const commands = () => props.commands?.() ?? {};

  const padTop = () => {
    const v = props.padTop;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };

  // padBottom signal: either driven by the composer slot ResizeObserver (when
  // composer === 'slot') or by the external padBottom prop.
  const [slotPadBottom, setSlotPadBottom] = createSignal(0);
  const padBottom = () => {
    if (props.composer === 'slot') return slotPadBottom();
    const v = props.padBottom;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };

  const inheritedDebug = useContext(DebugContext);
  const debugValue = () => props.debug ?? inheritedDebug();

  // View state — owned by ChatRoot (collapse, expandedUserId). Created here so
  // it persists for the lifetime of this mount and is independent per view.
  const viewState = createViewState();
  const [expandedUserId, setExpandedUserIdSignal] = createSignal<string | null>(null);

  let scrollEl: HTMLDivElement | undefined;
  let canvasEl: HTMLDivElement | undefined;
  let outerEl: HTMLDivElement | undefined;
  let composerSlotEl: HTMLElement | undefined;
  const virt = new Virtualizer();
  // Visible row wrapper elements keyed by unit index.
  const rowEls = new Map<number, HTMLDivElement>();

  const [totalHeight, setTotalHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollVelocity, setScrollVelocity] = createSignal(0);
  const [viewHeight, setViewHeight] = createSignal(600);
  const [containerWidth, setContainerWidth] = createSignal(0);

  // measureEpoch comes from ChatContext so all views share one epoch signal.
  // When fonts load, ChatContext bumps it and all views re-measure.
  const measureEpoch = props.context.measureEpoch;

  const refreshTotal = () => {
    setTotalHeight(virt.total());
  };

  // ── Geometry shadow ───────────────────────────────────────────────────────
  const contentH = () => totalHeight() + padTop() + padBottom();
  const maxScrollTop = () => Math.max(0, contentH() - viewHeight());
  const stuckIntent = () => maxScrollTop() - scrollTop() <= STICK_THRESHOLD_PX;

  // ── Flat unit view (two-tier, incremental) ────────────────────────────────
  const segmentCtx = createMemo(() => ({
    caches,
    expanded: (_id: string) => false,
  }));

  let committedUnitsArr: ReturnType<typeof flattenTier> = [];
  let lastCommitted: readonly ChatItem[] = [];
  const [committedUnitsVersion, setCommittedUnitsVersion] = createSignal(0);

  createEffect(() => {
    const next = props.state.transcript.state.committed;
    const prev = lastCommitted;
    const ctx = segmentCtx();

    if (
      next.length > prev.length &&
      (prev.length === 0 ? true : prev.every((item, i) => next[i] === item))
    ) {
      const tail = next.slice(prev.length);
      const prevKind =
        committedUnitsArr.length > 0
          ? committedUnitsArr[committedUnitsArr.length - 1].kind
          : undefined;
      const newUnits = flattenTier(tail, ctx, SEGMENTERS, UNIT_REGISTRY, prevKind);
      committedUnitsArr = [...committedUnitsArr, ...newUnits];
    } else {
      committedUnitsArr = flattenTier(next, ctx, SEGMENTERS, UNIT_REGISTRY);
    }

    lastCommitted = next;
    setCommittedUnitsVersion((v) => v + 1);
  });

  const activeUnits = createMemo(() => {
    committedUnitsVersion();
    const at = props.state.transcript.state.activeTurn;
    if (!at || at.length === 0) return [] as ReturnType<typeof flattenTier>;
    const prevKind =
      committedUnitsArr.length > 0
        ? committedUnitsArr[committedUnitsArr.length - 1].kind
        : undefined;
    return flattenTier(at, segmentCtx(), SEGMENTERS, UNIT_REGISTRY, prevKind);
  });

  const units = createMemo<UnitsView>(() => {
    committedUnitsVersion();
    return makeUnitsView(committedUnitsArr, activeUnits());
  });

  const userTopGap = UNIT_REGISTRY.message?.margin?.top ?? 8;

  // ── Count sync effect ─────────────────────────────────────────────────────
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
        expandedId: expandedUserId(),
      };
      virt.setCount(us.length, (i) => {
        const u = us.at(i);
        if (!u) return 60;
        const unitDef = UNIT_REGISTRY[u.kind];
        const contentH =
          unitDef?.estimate?.(u.data, estimateCtx, unitDef.vars ?? {}) ??
          genericEstimate(u.data as unknown as ChatItem, estimateCtx);
        return unitReservedHeight(u, contentH);
      });
      refreshTotal();
      if (props.stickToBottom !== false && stuckIntent()) {
        const target = maxScrollTop();
        if (scrollEl) {
          scrollEl.scrollTop = target;
          expectedScrollTop = target;
        }
        setScrollTop(target);
      }
    });
  });

  // Width change: do NOT flush caches. The per-block fingerprint
  // (measureEpoch|width|collapsed) already handles width invalidation.
  // richInline cache is width-independent (intrinsic glyph widths).
  // measureEpoch bumps (on font load) invalidate everything globally.

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
  const userTurns = createMemo(() =>
    collectUserTurnUnits(props.state.transcript.state.committed, units())
  );

  const pinState = createMemo(() => {
    if (!props.pinUserMessages) return null;
    const turns = userTurns();
    if (turns.length === 0) return null;

    const st = scrollTop();
    const pt = padTop();
    totalHeight();

    const pinLine = userTopGap;

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

    if (activePos < 0) return null;

    const activeUserIdx = turns[activePos];
    const nextUserIdx = turns[activePos + 1];
    let overlayH = 0;
    const activeUnit = units().at(activeUserIdx);
    if (activeUnit) {
      const activeItemId = activeUnit.itemId;
      for (let ui = activeUserIdx; ui < units().length; ui++) {
        const u = units().at(ui);
        if (!u || u.itemId !== activeItemId) break;
        overlayH += virt.size(ui);
      }
    }

    const nextUserViewportTop =
      nextUserIdx !== undefined ? virt.top(nextUserIdx) + pt - st : Infinity;
    const overlayTop = Math.min(0, nextUserViewportTop - overlayH - pinLine);

    return { activeUserIdx, overlayTop };
  });

  // ── Per-frame height coalescing ───────────────────────────────────────────
  let expectedScrollTop = 0;
  let totalDirty = false;

  const queueTotalFlush = () => {
    if (totalDirty) return;
    totalDirty = true;
    scheduler.request();
  };

  // ── onHeightChanged — fully read-free ─────────────────────────────────────
  const onHeightChanged = (index: number, delta: number) => {
    if (delta === 0) return;
    queueTotalFlush();

    if (props.stickToBottom !== false && stuckIntent()) {
      const target = maxScrollTop();
      if (scrollEl) {
        scrollEl.scrollTop = target;
        expectedScrollTop = target;
      }
      setScrollTop(target);
    } else if (virt.top(index) + padTop() < scrollTop()) {
      const next = scrollTop() + delta;
      if (scrollEl) {
        scrollEl.scrollTop = next;
        expectedScrollTop = next;
      }
      setScrollTop(next);
    }
  };

  // ── Frame scheduler — created EAGERLY (before onMount) ───────────────────
  //
  // Hoisted to component scope so tween arming (from UnitRow createEffects)
  // never hits a null reference. Phases guard on scrollEl for pre-mount safety.
  //
  // Local state vars that phases reference — hoisted from onMount:
  let lastScrollTop = 0;
  let atBottom = false;
  let reachStartFired = false;

  const readPhase = () => {
    const el = scrollEl;
    if (!el) return;
    const st = el.scrollTop;
    const userScrolled = st !== expectedScrollTop;
    setScrollVelocity(st - lastScrollTop);
    lastScrollTop = st;
    setScrollTop(st);

    const nowAtBottom = stuckIntent();
    if (nowAtBottom !== atBottom) {
      atBottom = nowAtBottom;
      props.onAtBottomChange?.(atBottom);
    }

    if (st <= REACH_START_THRESHOLD_PX) {
      if (!reachStartFired) {
        reachStartFired = true;
        props.onReachStart?.();
      }
    } else {
      reachStartFired = false;
    }

    if (userScrolled) {
      cancelPrefetch();
      prefetchStart = -1;
      prefetchEnd = -1;
    }
    schedulePrefetch();
  };

  const animatePhase = (): boolean => tweenRegistry.advance(performance.now());

  const writePhase = (): boolean => {
    if (totalDirty) {
      totalDirty = false;
      setTotalHeight(virt.total());
    }
    const pt = padTop();
    for (const idx of visibleIndexes()) {
      const el = rowEls.get(idx);
      if (el) el.style.transform = `translateY(${virt.top(idx) + pt}px)`;
    }
    if (canvasEl) canvasEl.style.height = `${contentH()}px`;
    return false;
  };

  const scheduler = createFrameScheduler({
    read: readPhase,
    animate: animatePhase,
    write: writePhase,
  });
  onCleanup(() => scheduler.dispose());

  // ── Central tween registry — wired to eager scheduler ────────────────────
  const tweenRegistry = createTweenRegistry(virt, onHeightChanged, {
    requestFrame: () => scheduler.request(),
  });

  // Idle-time prefetch state — referenced by readPhase / schedulePrefetch
  let prefetchIdleId: ReturnType<typeof requestIdleCallback> | null = null;
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

    const ahead = Math.min(visEnd + PREFETCH_AHEAD, n - 1);
    const behind = Math.max(visStart - PREFETCH_BEHIND, 0);

    if (prefetchStart < 0 || prefetchEnd < 0) {
      prefetchStart = visEnd + 1;
      prefetchEnd = ahead;
    }

    const w = containerWidth();
    const t = theme();

    let measured = 0;

    const prefetchUnit = (ui: number): void => {
      const u = us.at(ui);
      if (!u) return;
      const unitDef = UNIT_REGISTRY[u.kind];
      if (!unitDef) return;
      const c = u.chrome;
      const unitInsetX = c?.insetX ?? 0;
      const ctx: MeasureCtx = {
        theme: t,
        width: Math.max(0, w - 2 * unitInsetX),
        isCollapsed: (id: string) => viewState.isCollapsed(id),
        expanded: (id: string) => viewState.isCollapsed(id),
        caches,
        measureEpoch: measureEpoch(),
        expandedId: expandedUserId(),
      };
      const contentH = unitDef.measure(u.data, ctx, unitDef.vars ?? {});
      const h = unitReservedHeight(u, contentH);
      const delta = virt.setSize(ui, h);
      if (delta !== 0) onHeightChanged(ui, delta);
    };

    while (prefetchStart <= prefetchEnd && deadline.timeRemaining() >= PREFETCH_MIN_REMAINING_MS) {
      prefetchUnit(prefetchStart);
      measured++;
      prefetchStart++;
    }

    if (prefetchStart > prefetchEnd) {
      let backCursor = visStart - 1;
      while (backCursor >= behind && deadline.timeRemaining() >= PREFETCH_MIN_REMAINING_MS) {
        prefetchUnit(backCursor);
        measured++;
        backCursor--;
      }
    }

    if (measured > 0 && prefetchStart <= prefetchEnd) {
      schedulePrefetch();
    }
  };

  // ── Scroll helpers ────────────────────────────────────────────────────────
  const doScrollToBottom = (opts?: { behavior?: ScrollBehavior }) => {
    const el = scrollEl;
    if (!el) return;
    const target = maxScrollTop();
    if (opts?.behavior === 'smooth') {
      el.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      el.scrollTop = target;
      expectedScrollTop = target;
      setScrollTop(target);
    }
  };

  const doScrollToItem = (id: string, opts?: ScrollToItemOptions) => {
    const el = scrollEl;
    if (!el) return;

    const us = units();
    let unitIdx = -1;
    for (let i = 0; i < us.length; i++) {
      if (us.at(i)?.itemId === id) {
        unitIdx = i;
        break;
      }
    }
    if (unitIdx < 0) return;

    let itemTotalH = 0;
    for (let i = unitIdx; i < us.length; i++) {
      if (us.at(i)?.itemId !== id) break;
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

    const t0 = computeTarget();
    el.scrollTo({ top: t0, behavior });
    expectedScrollTop = t0;

    if (behavior !== 'smooth') {
      requestAnimationFrame(() => {
        const t1 = computeTarget();
        el.scrollTo({ top: t1, behavior: 'auto' });
        expectedScrollTop = t1;
      });
    }
  };

  const doLoadOlder = (items: ChatItem[]) => {
    const el = scrollEl;
    if (!el || items.length === 0) return;

    const t = theme();

    const anchorUnitIdx = virt.findIndex(Math.max(0, el.scrollTop - padTop()));
    const anchorId = units().at(anchorUnitIdx)?.itemId;
    const anchorOffset = el.scrollTop - (virt.top(anchorUnitIdx) + padTop());

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
      if (!item) return userTopGap + 60;
      const unitDef = UNIT_REGISTRY[item.kind];
      const contentH =
        unitDef?.estimate?.(item, loadEstimateCtx, unitDef.vars ?? {}) ??
        genericEstimate(item, loadEstimateCtx);
      return userTopGap + contentH;
    });

    props.state.transcript.history.prepend(items);
    refreshTotal();

    if (anchorId !== undefined) {
      const newUs = units();
      let newUnitIdx = -1;
      for (let i = 0; i < newUs.length; i++) {
        if (newUs.at(i)?.itemId === anchorId) {
          newUnitIdx = i;
          break;
        }
      }
      if (newUnitIdx >= 0) {
        const newTop = virt.top(newUnitIdx) + padTop() + anchorOffset;
        el.scrollTop = newTop;
        expectedScrollTop = newTop;
        setScrollTop(newTop);
      }
    }
  };

  // ── DOM setup ─────────────────────────────────────────────────────────────
  onMount(() => {
    const el = scrollEl!;

    // Populate the controls holder so handle delegates resolve immediately.
    if (props.controls) {
      props.controls.scrollToBottom = doScrollToBottom;
      props.controls.scrollToItem = doScrollToItem;
      props.controls.loadOlder = doLoadOlder;
      props.controls.toggleCollapsed = (id) => viewState.toggleCollapsed(id);
      props.controls.getExpandedUserId = () => expandedUserId();
      props.controls.setExpandedUserId = (id) => setExpandedUserIdSignal(id);
      props.controls.composerSlot = composerSlotEl ?? null;
      // Notify the view creator that all controls are wired.
      props.controls.onMounted?.();
    }

    atBottom = stuckIntent();
    expectedScrollTop = el.scrollTop;

    const onScroll = () => {
      if (el.offsetParent === null) return;
      scheduler.request();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => {
      el.removeEventListener('scroll', onScroll);
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

    // Composer slot: measure its height and drive padBottom.
    if (props.composer === 'slot' && composerSlotEl) {
      const roSlot = new ResizeObserver((entries) => {
        const h = entries[0]?.contentRect.height ?? 0;
        setSlotPadBottom(h);
      });
      roSlot.observe(composerSlotEl);
      onCleanup(() => roSlot.disconnect());
    }

    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;

      const userCard = t.closest('[data-user-card]') as HTMLElement | null;
      if (userCard?.dataset.userCard) {
        const id = userCard.dataset.userCard;
        if (expandedUserId() !== id) {
          setExpandedUserIdSignal(id);
        }
        return;
      }

      const collapseTarget = t.closest('[data-collapse-id]') as HTMLElement | null;
      if (collapseTarget?.dataset.collapseId) {
        viewState.toggleCollapsed(collapseTarget.dataset.collapseId);
        return;
      }

      if (expandedUserId() !== null) {
        setExpandedUserIdSignal(null);
      }
    };
    const clickTarget = outerEl ?? el;
    clickTarget.addEventListener('click', onClick);
    onCleanup(() => clickTarget.removeEventListener('click', onClick));

    // Visibility watchdog: self-heal any missed wakes when pane becomes visible.
    if (typeof document !== 'undefined') {
      const onVisibilityChange = () => {
        if (!document.hidden) {
          scheduler.forceReconcile(() => {
            totalDirty = true;
          });
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      onCleanup(() => document.removeEventListener('visibilitychange', onVisibilityChange));
    }

    if (props.stickToBottom !== false) {
      const target = el.scrollHeight - el.clientHeight;
      el.scrollTop = target;
      expectedScrollTop = target;
      setScrollTop(target);
    }

    // Force an initial reconcile pass so the scheduler runs once on attach.
    scheduler.forceReconcile(() => {
      totalDirty = true;
    });
  });

  // ── Active-turn id set ────────────────────────────────────────────────────
  const activeTurnItemIds = createMemo(() => {
    const active = props.state.transcript.state.activeTurn;
    if (!active) return new Set<string>();
    return new Set(active.map((i) => i.id));
  });

  const currentMessageId = createMemo<string | null>(() => {
    const committed = props.state.transcript.state.committed;
    for (let i = committed.length - 1; i >= 0; i--) {
      const item = committed[i];
      if (item.kind === 'message' && item.role === 'user') return item.id;
    }
    return null;
  });

  const turnStatus = () => props.state.transcript.state.turnStatus;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DebugContext.Provider value={debugValue}>
      <ThemeContext.Provider value={theme}>
        <CachesContext.Provider value={caches}>
          <CommandsContext.Provider value={commands}>
            <TurnStateContext.Provider value={{ currentMessageId, turnStatus }}>
              <div
                ref={(el) => {
                  outerEl = el;
                }}
                class={outerClip}
              >
                <div
                  ref={(el) => {
                    scrollEl = el;
                  }}
                  data-chat-scroll
                  class={`${scrollContainer}${props.class ? ` ${props.class}` : ''}`}
                  style={scrollElStyle}
                >
                  <div
                    ref={(el) => {
                      canvasEl = el;
                      el.style.height = `${contentH()}px`;
                    }}
                    data-chat-canvas
                    class={`${canvas} ${contentClass()}`}
                  >
                    <For each={visibleIndexes()}>
                      {(unitIndex) => {
                        const u = () => units().at(unitIndex);
                        const isActiveTurn = () => {
                          const unit = u();
                          return unit ? activeTurnItemIds().has(unit.itemId) : false;
                        };

                        return (
                          <Show when={u()}>
                            <div
                              class={unitRowWrapper}
                              ref={(el) => {
                                rowEls.set(unitIndex, el);
                                el.style.transform = `translateY(${virt.top(unitIndex) + padTop()}px)`;
                                onCleanup(() => rowEls.delete(unitIndex));
                              }}
                              data-index={String(unitIndex)}
                            >
                              <UnitRow
                                unit={u()!}
                                index={unitIndex}
                                rowWidth={containerWidth()}
                                theme={theme()}
                                viewState={viewState}
                                virt={virt}
                                onHeightChanged={onHeightChanged}
                                tweenRegistry={tweenRegistry}
                                isActiveTurn={isActiveTurn()}
                                caches={caches}
                                measureEpoch={measureEpoch()}
                                expandedId={expandedUserId()}
                              />
                            </div>
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                </div>
                <Show when={pinState()}>
                  {(state) => (
                    <div
                      class={`${pinnedOverlay} ${contentClass()}`}
                      aria-hidden="true"
                      style={{ transform: `translateY(${state().overlayTop}px)` }}
                    >
                      <PinnedUserMessage
                        item={
                          (() => {
                            const unit = units().at(state().activeUserIdx);
                            if (!unit) return undefined;
                            return props.state.transcript.state.committed.find(
                              (i) => i.id === unit.itemId
                            ) as ChatMessage | undefined;
                          })()!
                        }
                        rowWidth={containerWidth()}
                        theme={theme()}
                        caches={caches}
                        expandedId={expandedUserId}
                      />
                    </div>
                  )}
                </Show>
                {/* Composer slot: empty div that the host portals its React
                    composer into. ResizeObserver on it drives padBottom. */}
                <Show when={props.composer === 'slot'}>
                  <div
                    ref={(el) => {
                      composerSlotEl = el;
                    }}
                    class={composerSlotClass}
                  />
                </Show>
              </div>
            </TurnStateContext.Provider>
          </CommandsContext.Provider>
        </CachesContext.Provider>
      </ThemeContext.Provider>
    </DebugContext.Provider>
  );
}

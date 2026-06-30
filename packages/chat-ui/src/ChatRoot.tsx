/**
 * ChatRoot — the Solid component that implements the chat transcript renderer.
 *
 * Architecture (ChatContext / ChatState / ChatView split):
 *   - ChatContext is passed as `props.context`: provides theme, shared caches,
 *     measureEpoch, and the Shiki highlighter.
 *   - ChatState is passed as `props.state`: provides transcript + parse caches.
 *   - ChatState is passed as `props.state`: provides transcript, parse caches,
 *     and per-conversation view state (viewState, expandedUserId, scroll anchor,
 *     heightmap). These survive view dispose/recreate (e.g. tab switches).
 *   - ChatRoot owns the virtualizer, frame scheduler, and tween registry.
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
  on,
  onCleanup,
  onMount,
  untrack,
  useContext,
} from 'solid-js';
import type { ChatContext } from './chat-context';
import type { ChatCommands, ScrollToItemOptions } from './commands';
import { CachesContext } from './components/contexts/CachesContext';
import { CommandsContext } from './components/contexts/CommandsContext';
import { DebugContext } from './components/contexts/debug-context';
import { ThemeContext } from './components/contexts/ThemeContext';
import { TurnStateContext } from './components/contexts/TurnStateContext';
import { createFrameScheduler } from './components/engine/frame-scheduler';
import { createTweenRegistry } from './components/engine/tween-registry';
import { NODE_SEGMENTERS, SEGMENTERS, UNIT_REGISTRY } from './components/engine/unit-registry';
import { UnitRow } from './components/engine/UnitRow';
import { PinnedUserMessage } from './components/rows/message/PinnedUserMessage';
import type { ChatCaches } from './core/caches';
import type { ThemeVarKey } from './core/config';
import type { MeasureCtx } from './core/define';
import { genericEstimate } from './core/layout/generic-estimate';
import { STICK_THRESHOLD_PX } from './core/stick-to-bottom';
import { unitReservedHeight } from './core/units';
import { Virtualizer } from './core/virtualizer';
import type { ChatItem, ChatMessage } from './model';
import type { ChatState, ScrollMode } from './state/chat-state';
import { flattenTier, makeUnitsView, collectUserTurnUnits } from './state/flatten';
import type { UnitsView } from './state/flatten';
import { getItem } from './state/transcript';
import {
  canvas,
  composerSlotClass,
  composerSlotInnerClass,
  contentOverlaySlotClass,
  defaultContentClass,
  outerClip,
  pinnedOverlay,
  scrollContainer,
  unitRowWrapper,
  widthProbeClass,
} from './chat-root.css';
import './chat-fonts.css';
import { vars } from './styles/theme.css';

// Centered content column. The scroll container stays full width (so the
// scrollbar sits at the viewport edge) while rows are measured and laid out
// against this capped, centered canvas — matching the desktop composer width.
const DEFAULT_CONTENT_CLASS = defaultContentClass;

// Vertical breathing room added above the first row and below the last row.
const TRANSCRIPT_VERTICAL_PADDING = 32;

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
  /**
   * Reference to the composer slot element. Set by ChatRoot after mount when
   * `composer === 'slot'`. The host portals its React composer into this element.
   */
  composerSlot?: HTMLElement | null;
  /**
   * Reference to the content overlay slot element. Set after mount when
   * `contentOverlay` is true. The host portals overlay content into it.
   */
  contentOverlay?: HTMLElement | null;
  /**
   * Declaratively set scroll intent; ChatRoot projects it immediately.
   * Wired by onMount; safe to call from outside the Solid reactive context.
   */
  setScrollMode?(mode: ScrollMode): void;
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
  /**
   * Per-conversation state: transcript + parse caches.
   * Accepts either a plain ChatState or a reactive accessor `() => ChatState`
   * (provided by createChatView for the setModel path).
   */
  state: ChatState | (() => ChatState);
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
  /**
   * When true, render an absolutely-positioned overlay slot above the
   * transcript/scroll but below the composer (z-index 15). Hosts portal
   * loading/empty/disabled states into `controls.contentOverlay`.
   */
  contentOverlay?: boolean;
};

// ── ChatRoot ──────────────────────────────────────────────────────────────────

export function ChatRoot(props: ChatRootProps) {
  // Normalize state prop to an accessor so ChatRoot is reactive when the host
  // swaps models via view.setModel(). Plain ChatState objects (the common path)
  // are wrapped in a stable closure that never changes its value.
  const state: () => ChatState =
    typeof props.state === 'function' ? props.state : () => props.state as ChatState;

  // Assemble the full ChatCaches bundle from context (shared) + state (parse).
  // Leaf components (Code.tsx, Diff.tsx) consume this via useCaches().
  // Memo so it recomputes when the model swaps (new parseCaches).
  const caches = createMemo<ChatCaches>(() => ({
    ...props.context.sharedCaches,
    ...state().parseCaches,
  }));

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
    return (v === undefined ? 0 : typeof v === 'function' ? v() : v) + TRANSCRIPT_VERTICAL_PADDING;
  };

  // padBottom signal: either driven by the composer slot ResizeObserver (when
  // composer === 'slot') or by the external padBottom prop.
  // TRANSCRIPT_VERTICAL_PADDING is added on both paths so there is always
  // 32px of breathing room below the last row.
  const [slotPadBottom, setSlotPadBottom] = createSignal(0);
  const padBottom = () => {
    if (props.composer === 'slot') return slotPadBottom() + TRANSCRIPT_VERTICAL_PADDING;
    const v = props.padBottom;
    return (v === undefined ? 0 : typeof v === 'function' ? v() : v) + TRANSCRIPT_VERTICAL_PADDING;
  };

  const inheritedDebug = useContext(DebugContext);
  const debugValue = () => props.debug ?? inheritedDebug();

  // View state — owned by ChatState so it persists across view remounts.
  // All three are accessor functions so they always target the CURRENT model.
  const viewState = () => state().viewState;
  const expandedUserId = () => state().expandedUserId.get();
  const setExpandedUserId = (id: string | null) => state().expandedUserId.set(id);

  let scrollEl: HTMLDivElement | undefined;
  let canvasEl: HTMLDivElement | undefined;
  let outerEl: HTMLDivElement | undefined;
  // Zero-height probe that carries contentClass; the width ResizeObserver
  // targets this so it only fires on genuine layout-width changes.
  let widthProbeEl: HTMLDivElement | undefined;
  let composerSlotEl: HTMLElement | undefined;
  let contentOverlaySlotEl: HTMLElement | undefined;
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
  //
  // activeTurnReserve: the min-height of the active turn's response region,
  // expressed as trailing canvas space. When the tail of content (from the last
  // user message to the end) is shorter than the viewport, the reserve expands
  // maxScrollTop so projectAnchor('anchor'/'top') can place the user message at the
  // top. As the agent streams a response, tailHeight grows, reserve shrinks,
  // and once the tail fills the viewport reserve is 0 (normal scrolling).
  //
  // INVARIANT: derives from virt.total() (real measured heights) and is added
  // only in contentH — never fed back into virt — so there is no feedback loop
  // and the heightmap is never polluted with reserve padding.
  //
  // Gated by pinUserMessages so views that don't need this behavior are unaffected.
  // lastUserUnitIdx() is memoized on transcript changes, not per streaming tick.
  const activeTurnReserve = () => {
    if (!props.pinUserMessages) return 0;
    const idx = lastUserUnitIdx();
    if (idx < 0) return 0;
    const tailHeight = totalHeight() - virt.top(idx);
    // Subtract padBottom (composer height + TRANSCRIPT_VERTICAL_PADDING) so the
    // reserve grants exactly enough room to bring the user message flush to the
    // top edge, not past it. Without this, a short agent response allows the
    // user message to over-scroll into blank space below the composer.
    return Math.max(0, viewHeight() - padBottom() - tailHeight);
  };

  const contentH = () => totalHeight() + padTop() + padBottom() + activeTurnReserve();
  const maxScrollTop = () => Math.max(0, contentH() - viewHeight());

  // ── Flat unit view (two-tier, incremental) ────────────────────────────────
  const segmentCtx = createMemo(() => ({
    caches: caches(),
    expanded: (_id: string) => false,
  }));

  let committedUnitsArr: ReturnType<typeof flattenTier> = [];
  let lastCommitted: readonly ChatItem[] = [];
  const [committedUnitsVersion, setCommittedUnitsVersion] = createSignal(0);
  // Stable empty array passed to makeUnitsView when we need a committed-only
  // view. Must not change identity so memos don't re-run on each access.
  const NO_ACTIVE_UNITS: ReturnType<typeof flattenTier> = [];

  // ── Model-swap reset (must be created BEFORE the incremental committed effect)
  // When state() changes (view.setModel), clear the incremental cache so the
  // committed effect re-seeds from scratch against the new model. The deferred
  // on() ensures this only fires on subsequent changes, not on initial mount.
  createEffect(
    on(
      state,
      () => {
        committedUnitsArr = [];
        lastCommitted = [];
        // Do NOT bump committedUnitsVersion here — the incremental effect below
        // runs next (Solid executes effects in creation order) and will bump it
        // after rebuilding from the new model's committed items.
      },
      { defer: true }
    )
  );

  createEffect(() => {
    const next = state().transcript.state.committed;
    const prev = lastCommitted;
    const ctx = segmentCtx();

    if (
      next.length > prev.length &&
      (prev.length === 0 || next[prev.length - 1] === prev[prev.length - 1])
    ) {
      const tail = next.slice(prev.length);
      const prevKind =
        committedUnitsArr.length > 0
          ? committedUnitsArr[committedUnitsArr.length - 1].kind
          : undefined;
      const newUnits = flattenTier(tail, ctx, SEGMENTERS, UNIT_REGISTRY, prevKind, NODE_SEGMENTERS);
      committedUnitsArr = [...committedUnitsArr, ...newUnits];
    } else {
      committedUnitsArr = flattenTier(
        next,
        ctx,
        SEGMENTERS,
        UNIT_REGISTRY,
        undefined,
        NODE_SEGMENTERS
      );
    }

    lastCommitted = next;
    setCommittedUnitsVersion((v) => v + 1);
  });

  const activeUnits = createMemo(() => {
    committedUnitsVersion();
    const at = state().transcript.state.activeTurn;
    if (!at || at.length === 0) return [] as ReturnType<typeof flattenTier>;
    const prevKind =
      committedUnitsArr.length > 0
        ? committedUnitsArr[committedUnitsArr.length - 1].kind
        : undefined;
    return flattenTier(at, segmentCtx(), SEGMENTERS, UNIT_REGISTRY, prevKind, NODE_SEGMENTERS);
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
        caches: caches(),
        measureEpoch: measureEpoch(),
        expandedId: expandedUserId(),
      };
      // lastWidth > 0 iff onCleanup wrote a snapshot on a prior dispose.
      // Skip the Map.get pass entirely on cold mounts (empty heightmap).
      const currentState = state();
      const hasHeightmapSnapshot = currentState.heightmap.lastWidth > 0;
      virt.setCount(us.length, (i) => {
        const u = us.at(i);
        if (!u) return 60;
        // Use the persisted measured height if available (avoids scrollbar drift
        // on remount). Falls back to the cheap estimate for rows never measured
        // or when the heightmap was seeded at a different container width
        // (the scroll anchor will still restore the correct position).
        if (hasHeightmapSnapshot) {
          const snapped = currentState.heightmap.get(u.id);
          if (snapped !== undefined) return snapped;
        }
        const unitDef = UNIT_REGISTRY[u.kind];
        const contentH =
          unitDef?.estimate?.(u.data, estimateCtx, unitDef.vars ?? {}) ??
          genericEstimate(u.data as unknown as ChatItem, estimateCtx);
        return unitReservedHeight(u, contentH);
      });
      refreshTotal();
      // Re-project the current intent against the new geometry so that all
      // modes (tail, anchor) stay correct after an async seed or content change.
      // projectAnchor flushes canvas height first so scrollTop is never clamped
      // to the outgoing canvas height.
      projectAnchor(anchor());
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
  // Tracks committedUnitsVersion only — not units() — so it does not recompute
  // on every streaming frame. collectUserTurnUnits only looks at committed items
  // by design (see flatten.test.ts "does not include activeTurn user messages"),
  // and committed units are always the [0, committedUnitsArr.length) prefix of
  // the full units() view, so the returned absolute indices remain valid.
  const userTurns = createMemo(() => {
    committedUnitsVersion();
    return collectUserTurnUnits(
      state().transcript.state.committed,
      makeUnitsView(committedUnitsArr, NO_ACTIVE_UNITS)
    );
  });

  // ── Last user message unit index ──────────────────────────────────────────
  // Finds the first unit index (in the full units() view) for the last user-
  // role message. Scans activeTurn first so the reserve picks up the freshly-
  // sent message during streaming (ACP bundles the prompt + response into one
  // activeTurn), then falls back to committed. Used by reservedBottom below.
  //
  // Memoized on committedUnitsVersion + activeTurn identity so it does not
  // recompute on every streaming text patch (only on structural turn changes).
  const lastUserUnitIdx = createMemo(() => {
    committedUnitsVersion();
    const transcript = state().transcript.state;
    let targetId: string | null = null;

    // 1. Scan activeTurn backward for the latest user message.
    const active = transcript.activeTurn;
    if (active) {
      for (let i = active.length - 1; i >= 0; i--) {
        const item = active[i];
        if (item && item.kind === 'message' && (item as ChatMessage).role === 'user') {
          targetId = item.id;
          break;
        }
      }
    }

    // 2. Fall back to the last committed user message.
    if (targetId === null) {
      const committed = transcript.committed;
      for (let i = committed.length - 1; i >= 0; i--) {
        const item = committed[i];
        if (item && item.kind === 'message' && (item as ChatMessage).role === 'user') {
          targetId = item.id;
          break;
        }
      }
    }

    if (targetId === null) return -1;

    // 3. Map itemId to its first unit index in the full (committed + active) view.
    const us = units();
    for (let i = 0; i < us.length; i++) {
      if (us.at(i)?.itemId === targetId) return i;
    }
    return -1;
  });

  const pinState = createMemo(() => {
    if (!props.pinUserMessages) return null;
    const committedTurns = userTurns();
    // Include the active-turn user message (optimistic send / live turn) so it
    // can pin to the top too. lastUserUnitIdx() resolves active-first, is
    // already memoized, and always sits after every committed unit, so
    // appending it preserves the ascending order the binary search requires.
    const activeIdx = lastUserUnitIdx();
    const turns =
      activeIdx >= 0 &&
      (committedTurns.length === 0 || activeIdx > committedTurns[committedTurns.length - 1])
        ? [...committedTurns, activeIdx]
        : committedTurns;
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

  // ── Scroll intent (ScrollMode) ────────────────────────────────────────────
  //
  // A declarative intent loaded from ChatState on mount/swap and persisted back
  // ── Scroll anchor (event-sourced intent) ─────────────────────────────────
  //
  // `anchor` is the single source of truth for scroll intent. It changes only
  // on named events: user scroll (readPhase), expand/collapse, send, host
  // setScrollMode, scrollToBottom/scrollToItem. It is NEVER re-derived from
  // geometry on idle frames — that feedback loop is what caused scroll jumps.
  //
  // `expectedScrollTop` tracks the last value we wrote so readPhase can tell
  // a real user scroll (st !== expected) from an idle frame or our own write
  // (st === expected). Deterministic; replaces the old microtask-fragile counter.

  // Seeded from the current model's persisted intent (may be default 'tail').
  const [anchor, setAnchorSignal] = createSignal<ScrollMode>(
    untrack(state).scroll.get(),
    // Use object equality: ScrollMode objects are small; avoid spurious
    // re-renders if the host calls setScrollMode with an equivalent object.
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );

  // Persist intent to ChatState and update the local signal atomically.
  const setAnchor = (m: ScrollMode) => {
    setAnchorSignal(m);
    state().scroll.set(m);
  };

  // Last scrollTop we wrote. Seeded to 0; adopted from browser-clamped value
  // after each write so clamped positions are never counted as user movement.
  let expectedScrollTop = 0;

  const writeScrollTop = (top: number) => {
    if (!scrollEl) return;
    scrollEl.scrollTop = top;
    // Adopt the browser-clamped value in case it differs from `top`.
    expectedScrollTop = scrollEl.scrollTop;
    setScrollTop(expectedScrollTop);
  };

  // O(n) scan for the first unit whose itemId matches. Used by projectScroll
  // for anchor and pinTop modes. N is the visible window (typically ≤ 50).
  const unitIndexOf = (id: string): number => {
    const us = untrack(units);
    for (let i = 0; i < us.length; i++) {
      if (us.at(i)?.itemId === id) return i;
    }
    return -1;
  };

  // The ONE function that writes scrollTop. Flush canvas height first so the
  // browser never clamps scrollTop to a stale (outgoing) canvas height — this
  // is the root cause of "open at top after tab switch".
  const projectAnchor = (m: ScrollMode) => {
    if (!scrollEl) return;
    // Synchronously update canvas height so scrollTop is never clamped.
    if (canvasEl) canvasEl.style.height = `${contentH()}px`;

    if (m.kind === 'anchor') {
      const i = unitIndexOf(m.itemId);
      if (i >= 0) {
        const rowTop = virt.top(i) + padTop();
        const target =
          m.edge === 'top'
            ? rowTop + m.offset
            : rowTop + virt.size(i) - viewHeight() + m.offset;
        writeScrollTop(Math.max(0, target));
        return;
      }
      // Anchor item not found (transcript not yet loaded); fall through to tail.
    }
    // tail mode (or anchor item not found yet): re-pin to end.
    if (props.stickToBottom !== false) {
      writeScrollTop(maxScrollTop());
    }
  };

  // ── Per-frame height coalescing ───────────────────────────────────────────
  let totalDirty = false;

  const queueTotalFlush = () => {
    if (totalDirty) return;
    totalDirty = true;
    scheduler.request();
  };

  // ── onHeightChanged — fully read-free ─────────────────────────────────────
  // Re-project the current intent so all modes stay correct as row heights
  // change (estimate→real cascade, streaming growth, resize). No more atBottom
  // gate or delta-shift branch — projectAnchor handles all cases uniformly.
  const onHeightChanged = (index: number, delta: number) => {
    if (delta === 0) return;
    queueTotalFlush();
    projectAnchor(anchor());
  };

  // ── Frame scheduler — created EAGERLY (before onMount) ───────────────────
  //
  // Hoisted to component scope so tween arming (from UnitRow createEffects)
  // never hits a null reference. Phases guard on scrollEl for pre-mount safety.
  let reachStartFired = false;

  // Smooth-scroll suppression: when a smooth-scroll animation is in flight,
  // intermediate scrollTop updates are browser-driven and must not be treated
  // as user input. While `smoothScrolling` is true, readPhase keeps
  // expectedScrollTop in sync and skips intent re-derivation.
  let smoothScrolling = false;
  let smoothScrollTarget: number | undefined;

  const readPhase = () => {
    const el = scrollEl;
    if (!el) return;
    const st = el.scrollTop;
    const userDelta = st - expectedScrollTop;
    setScrollVelocity(userDelta);
    setScrollTop(st);

    // Smooth-scroll suppression: while a smooth scroll animation is in flight
    // the browser moves scrollTop without user input. Keep expectedScrollTop in
    // sync so we don't misread intermediate frames as user scrolls.
    if (smoothScrolling) {
      expectedScrollTop = st;
      const target = smoothScrollTarget;
      if (target !== undefined && Math.abs(st - target) < 1) {
        smoothScrolling = false;
      }
      schedulePrefetch();
      return;
    }

    // Only re-derive intent when the user actually moved the scrollbar.
    // Idle frames where st === expectedScrollTop must never overwrite intent.
    if (userDelta !== 0) {
      expectedScrollTop = st;
      const nowAtBottom = maxScrollTop() - st <= STICK_THRESHOLD_PX;
      const prevAnchor = anchor();
      const prevAtBottom = prevAnchor.kind === 'tail';
      if (nowAtBottom) {
        if (!prevAtBottom) {
          setAnchor({ kind: 'tail' });
          props.onAtBottomChange?.(true);
        }
      } else {
        const pt = padTop();
        const anchorUnitIdx = virt.findIndex(Math.max(0, st - pt));
        const anchorUnit = units().at(anchorUnitIdx);
        if (anchorUnit) {
          setAnchor({
            kind: 'anchor',
            itemId: anchorUnit.itemId,
            edge: 'top',
            offset: st - (virt.top(anchorUnitIdx) + pt),
          });
        }
        if (prevAtBottom) {
          props.onAtBottomChange?.(false);
        }
      }
    }

    if (st <= REACH_START_THRESHOLD_PX) {
      if (!reachStartFired) {
        reachStartFired = true;
        props.onReachStart?.();
      }
    } else {
      reachStartFired = false;
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
        isCollapsed: (id: string) => viewState().isCollapsed(id),
        expanded: (id: string) => viewState().isCollapsed(id),
        caches: caches(),
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
    setAnchor({ kind: 'tail' });
    if (opts?.behavior === 'smooth') {
      smoothScrolling = true;
      smoothScrollTarget = target;
      el.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      writeScrollTop(target);
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

    // Commit the scroll as a top-edge anchor intent so onHeightChanged keeps
    // the row stable as content changes above.
    const anchorUnit = us.at(idx);
    if (anchorUnit) {
      const newOffset = t0 - (virt.top(idx) + padTop());
      setAnchor({
        kind: 'anchor',
        itemId: anchorUnit.itemId,
        edge: 'top',
        offset: newOffset + extraOffset,
      });
    }

    if (behavior === 'smooth') {
      smoothScrolling = true;
      smoothScrollTarget = t0;
      el.scrollTo({ top: t0, behavior: 'smooth' });
    } else {
      writeScrollTop(t0);
      requestAnimationFrame(() => {
        const t1 = computeTarget();
        writeScrollTop(t1);
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
      caches: caches(),
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

    state().transcript.history.prepend(items);
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
        writeScrollTop(newTop);
      }
    }
  };

  // ── Snapshot / restore helpers ────────────────────────────────────────────
  //
  // snapshotInto: persist only the heightmap. The scroll intent (ScrollMode)
  // is already kept current in ChatState by setAnchor() — no extra DOM reads
  // needed here. Called by the dispose onCleanup and by the swap effect.

  function snapshotInto(target: ChatState): void {
    const us = untrack(units);
    const w = untrack(containerWidth);
    const entries: Array<[string, number]> = [];
    for (let i = 0; i < us.length; i++) {
      const u = us.at(i);
      if (u) entries.push([u.id, virt.size(i)]);
    }
    target.heightmap.setAll(entries);
    target.heightmap.lastWidth = w;
    // ScrollMode is already persisted continuously by setAnchor() in readPhase
    // and by host calls to setScrollMode(). No DOM-derived anchor write here.
  }

  // attach: load the intent from a (possibly new) model and project it onto
  // the DOM. Synchronously flushes canvas height before writing scrollTop so
  // the browser never clamps to the outgoing model's stale canvas height —
  // the root cause of "open at top after tab switch".
  function attach(target: ChatState): void {
    const m = target.scroll.get();
    // Update the local signal without persisting (it already IS the canonical value).
    setAnchorSignal(m);
    projectAnchor(m);
  }

  // ── DOM setup ─────────────────────────────────────────────────────────────
  onMount(() => {
    const el = scrollEl!;

    // Populate the controls holder so handle delegates resolve immediately.
    if (props.controls) {
      props.controls.scrollToBottom = doScrollToBottom;
      props.controls.scrollToItem = doScrollToItem;
      props.controls.loadOlder = doLoadOlder;
      props.controls.toggleCollapsed = (id) => viewState().toggleCollapsed(id);
      props.controls.composerSlot = composerSlotEl ?? null;
      props.controls.contentOverlay = contentOverlaySlotEl ?? null;
      // Declarative scroll intent: host sets intent; ChatRoot projects it.
      props.controls.setScrollMode = (m: ScrollMode) => {
        setAnchor(m);
        projectAnchor(m);
      };
      // Notify the view creator that all controls are wired.
      props.controls.onMounted?.();
    }

    const onScroll = () => {
      if (el.offsetParent === null) return;
      scheduler.request();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => {
      el.removeEventListener('scroll', onScroll);
      cancelPrefetch();
    });

    // On dispose: snapshot measured row heights and scroll anchor into ChatState
    // so the next mount can seed the Virtualizer and restore position without
    // scrollbar drift (e.g. when switching conversation tabs).
    onCleanup(() => snapshotInto(state()));

    const roHeight = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setViewHeight(h);
    });
    roHeight.observe(el);
    onCleanup(() => roHeight.disconnect());

    // Target the zero-height width probe (carries contentClass / max-width cap)
    // instead of canvasEl so this observer only fires on genuine layout-width
    // changes and not on the canvas height mutations from streaming/tween updates.
    if (widthProbeEl) {
      const roWidth = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setContainerWidth(w);
      });
      roWidth.observe(widthProbeEl);
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
          setExpandedUserId(id);
        }
        return;
      }

      const collapseTarget = t.closest('[data-collapse-id]') as HTMLElement | null;
      if (collapseTarget?.dataset.collapseId) {
        const id = collapseTarget.dataset.collapseId;
        // Pin the toggled row at its current viewport position before the height
        // change. With readPhase no longer reclassifying intent on idle frames,
        // this anchor is now guaranteed to survive the tween — fixing the scroll
        // jump on expand/collapse in short reserve-active transcripts.
        const idx = unitIndexOf(id);
        if (idx >= 0 && scrollEl) {
          const offset = scrollEl.scrollTop - (virt.top(idx) + padTop());
          setAnchor({ kind: 'anchor', itemId: id, edge: 'top', offset });
        }
        viewState().toggleCollapsed(id);
        return;
      }

      if (expandedUserId() !== null) {
        setExpandedUserId(null);
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

    // Attach to the initial model: load its persisted scroll intent and project
    // it onto the DOM. Flushes canvas height first so scrollTop is never clamped.
    attach(state());

    // ── Model-swap effect (view.setModel path) ────────────────────────────
    // When the host calls view.setModel(newState), the `state` signal changes.
    // We snapshot the outgoing model's heightmap, then attach the incoming model
    // (load its ScrollMode intent + project onto DOM). Created here (inside
    // onMount) so scrollEl is guaranteed to be available when it fires.
    //
    // Ordering guarantee: the reset effect and incremental committed effect
    // (created before onMount in component scope) run first — virt is already
    // re-seeded with new heights by the time this swap effect fires.
    let prevModel = untrack(state);
    createEffect(
      on(
        state,
        (next) => {
          if (next === prevModel) return;
          snapshotInto(prevModel);
          prevModel = next;
          // virt is already re-seeded by count-sync effect (ran before this);
          // load the incoming model's intent and project it (no stale DOM reads).
          attach(next);
          scheduler.forceReconcile(() => {
            totalDirty = true;
          });
        },
        { defer: true }
      )
    );

    // Force an initial reconcile pass so the scheduler runs once on attach.
    scheduler.forceReconcile(() => {
      totalDirty = true;
    });
  });

  // ── Active-turn id set ────────────────────────────────────────────────────
  const activeTurnItemIds = createMemo(() => {
    const active = state().transcript.state.activeTurn;
    if (!active) return new Set<string>();
    return new Set(active.map((i) => i.id));
  });

  const currentMessageId = createMemo<string | null>(() => {
    const committed = state().transcript.state.committed;
    for (let i = committed.length - 1; i >= 0; i--) {
      const item = committed[i];
      if (item.kind === 'message' && item.role === 'user') return item.id;
    }
    return null;
  });

  const turnStatus = () => state().transcript.state.turnStatus;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DebugContext.Provider value={debugValue}>
      <ThemeContext.Provider value={theme}>
        <CachesContext.Provider value={caches()}>
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
                  {/* Zero-height probe: same max-width cap as rows; the width
                      ResizeObserver targets this to isolate layout-width changes
                      from canvas height mutations (streaming / tween updates). */}
                  <div
                    ref={(el) => {
                      widthProbeEl = el;
                    }}
                    aria-hidden="true"
                    class={`${widthProbeClass} ${contentClass()}`}
                  />
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
                                viewState={viewState()}
                                virt={virt}
                                onHeightChanged={onHeightChanged}
                                tweenRegistry={tweenRegistry}
                                isActiveTurn={isActiveTurn()}
                                caches={caches()}
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
                  {(ps) => {
                    const pinnedItem = (): ChatMessage | undefined => {
                      const unit = units().at(ps().activeUserIdx);
                      if (!unit) return undefined;
                      const transcript = state().transcript;
                      const idx = transcript.findIndexById(unit.itemId);
                      // Use getItem (committed-then-active) so optimistic / live
                      // active-turn user messages resolve correctly.
                      const item = idx >= 0 ? getItem(transcript.state, idx) : undefined;
                      // Validate kind+role so a corrupt idMap lookup can't hand a
                      // non-user item (or undefined) to PinnedUserMessage.
                      return item && item.kind === 'message' && item.role === 'user'
                        ? (item as ChatMessage)
                        : undefined;
                    };
                    return (
                      <Show when={pinnedItem()}>
                        {(item) => (
                          <div
                            class={pinnedOverlay}
                            aria-hidden="true"
                            style={{ transform: `translateY(${ps().overlayTop}px)` }}
                          >
                            {/* Inner centered column carries the max-width cap so
                                the pinned card matches the inline rows' width. The
                                gutter padding lives on the outer overlay (above),
                                mirroring the composer slot's two-level structure. */}
                            <div class={contentClass()}>
                              <PinnedUserMessage
                                item={item()}
                                rowWidth={containerWidth()}
                                theme={theme()}
                                caches={caches()}
                                expandedId={expandedUserId}
                              />
                            </div>
                          </div>
                        )}
                      </Show>
                    );
                  }}
                </Show>
                {/* Content overlay slot: absolute cover above transcript/scroll,
                    below the composer (z-index 15). Hosts portal loading/empty/
                    disabled states into this element. */}
                <Show when={props.contentOverlay}>
                  <div
                    ref={(el) => {
                      contentOverlaySlotEl = el;
                    }}
                    class={contentOverlaySlotClass}
                  />
                </Show>
                {/* Composer slot: full-width blurred backdrop strip; the inner
                    centered div is what the host portals its React composer
                    into, and what the ResizeObserver measures for padBottom. */}
                <Show when={props.composer === 'slot'}>
                  <div class={composerSlotClass}>
                    <div
                      ref={(el) => {
                        composerSlotEl = el;
                      }}
                      class={composerSlotInnerClass}
                    />
                  </div>
                </Show>
              </div>
            </TurnStateContext.Provider>
          </CommandsContext.Provider>
        </CachesContext.Provider>
      </ThemeContext.Provider>
    </DebugContext.Provider>
  );
}

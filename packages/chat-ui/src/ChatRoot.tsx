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
 * The Fenwick virtualizer (core/virtualizer.ts) is imperative; Solid's reactive
 * system is used only to trigger re-renders when height or scroll changes.
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
import { DebugContext } from './components/debug-context';
import { clearMessageLayoutCache } from './components/message/measure';
import { Row } from './components/Row';
import { ROW_REGISTRY } from './components/row-registry';
import { DEFAULT_FONT_CONFIG } from './core/measure/fonts';
import type { FontConfig } from './core/measure/fonts';
import { clearPretextCache, registerFontsReadyClear } from './core/measure/pretext-cache';
import { rowPadY } from './core/metrics';
import { StickToBottom } from './core/stick-to-bottom';
import { Virtualizer } from './core/virtualizer';
import { chatCssVars } from './css-vars';
import { getItem, itemCount } from './state/transcript';
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

export type ChatRootProps = {
  transcript: TranscriptApi;
  viewState: ViewState;
  fonts?: FontConfig;
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
};

export function ChatRoot(props: ChatRootProps) {
  const fonts = () => props.fonts ?? DEFAULT_FONT_CONFIG;
  const contentClass = () => props.contentClass ?? DEFAULT_CONTENT_CLASS;

  // Normalize padTop/padBottom to reactive accessors regardless of whether the
  // caller passed a static number (e.g. Storybook) or a signal getter (mountChat).
  const padTop = () => {
    const v = props.padTop;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };
  const padBottom = () => {
    const v = props.padBottom;
    return v === undefined ? 0 : typeof v === 'function' ? v() : v;
  };

  // Inherit an ambient debug flag (Storybook toolbar / parent provider) unless
  // an explicit `debug` prop is given. Without this, the provider below would
  // shadow the ambient one and force debug off for the whole subtree.
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

  // Recalculate total height from virt
  const refreshTotal = () => {
    setTotalHeight(virt.total());
  };

  // ── Count sync effect ─────────────────────────────────────────────────────

  createEffect(() => {
    // Subscribe only to the item count, not to every item's contents.
    const n = itemCount(props.transcript.state);
    const f = fonts();
    untrack(() => {
      virt.setCount(n, (i) => {
        const item = getItem(props.transcript.state, i);
        if (!item) return 60;
        const spec = ROW_REGISTRY[item.kind];
        return (
          spec.estimate(item, {
            fonts: f,
            rowWidth: 0,
            isCollapsed: () => false,
            measured: () => undefined,
          }) +
          2 * rowPadY(item.kind)
        );
      });
      refreshTotal();
      if (props.stickToBottom !== false) sticky?.schedule();
    });
  });

  // ── Width change: flush text-measurement cache ───────────────────────────
  // Only the currently-mounted rows need to re-measure, and they do so
  // automatically: each Row's layout memo depends on `props.rowWidth`, so it
  // recomputes and writes its new height via the height-bridge effect. Off-screen
  // rows keep their last height until scrolled back into view, then re-measure.
  // We must NOT loop all rows here — at 10k that subscribes the effect to every
  // store slot and overwrites measured heights with rough estimates.

  createEffect(() => {
    const w = containerWidth();
    if (w <= 0) return;
    clearPretextCache();
    clearMessageLayoutCache();
  });

  // ── Visible range — direction-aware asymmetric overscan ───────────────────

  const visibleRange = createMemo(() => {
    // Recompute the window whenever content size changes (rows added or
    // re-measured). Without this dependency the imperative virt.range() result
    // is cached against scroll/resize signals only, so an empty→first-item
    // transition (which changes neither) keeps the stale empty range and
    // nothing renders until a scroll or resize forces a recompute.
    totalHeight();
    const v = scrollVelocity();
    let before: number;
    let after: number;
    if (v > 0) {
      // Scrolling down: pre-buffer below the viewport
      before = OVERSCAN_TRAILING;
      after = OVERSCAN_LEADING;
    } else if (v < 0) {
      // Scrolling up: pre-buffer above the viewport
      before = OVERSCAN_LEADING;
      after = OVERSCAN_TRAILING;
    } else {
      // Idle or unknown direction: symmetric base overscan
      before = OVERSCAN_BASE;
      after = OVERSCAN_BASE;
    }
    // Subtract padTop so the viewport-relative scrollTop maps correctly to the
    // virtualizer's zero-based coordinate space (rows start at y=0 inside virt).
    return virt.range(Math.max(0, scrollTop() - padTop()), viewHeight(), before, after);
  });

  // ── Visible indexes ────────────────────────────────────────────────────────
  //
  // Solid's <For> is keyed by value, so rendering the visible row indices gives
  // us efficient reconciliation for free: scrolling the window by one row
  // disposes only the row that left and creates only the row that entered,
  // leaving every other row's DOM and reactive scope untouched. (We tried a
  // fixed <Index> slot pool / ring buffer, but it duplicated this behavior while
  // adding recycle-induced flicker — see git history.)
  const visibleIndexes = createMemo(() => {
    totalHeight(); // re-run when heights change (positions shift)
    const n = itemCount(props.transcript.state);
    const { start, end } = visibleRange();
    const visEnd = Math.min(end, n - 1);
    const arr: number[] = [];
    for (let i = start; i <= visEnd; i++) {
      arr.push(i);
    }
    return arr;
  });

  // ── Row top positions ─────────────────────────────────────────────────────

  // True while we mutate scrollEl.scrollTop ourselves, so the scroll listener
  // can ignore the self-induced event instead of kicking off another pass.
  let programmaticScroll = false;

  // Called by Row when its height changes after measurement
  const onHeightChanged = (index: number, delta: number) => {
    refreshTotal();
    if (delta === 0) return;

    // When pinned to the bottom, let stick-to-bottom own the scroll position.
    if (props.stickToBottom !== false && sticky?.isStuck()) {
      sticky.schedule();
      return;
    }

    // Anchor-correct whenever the changed row's *top* is above the scroll
    // position — this covers rows fully above the viewport AND rows that
    // straddle its top edge. A straddling row whose height settles after
    // measurement shifts every visible row below it by `delta`; without this
    // correction that shift surfaces as a scroll jump (typically right as
    // scrolling stops and the last measurement lands). Matches the reference
    // imperative engine, which corrects on `rowTop < scrollTop`.
    if (virt.top(index) + padTop() < scrollEl!.scrollTop) {
      const next = scrollEl!.scrollTop + delta;
      programmaticScroll = true;
      scrollEl!.scrollTop = next;
      setScrollTop(next);
    }
  };

  // ── DOM setup ─────────────────────────────────────────────────────────────

  onMount(() => {
    // scrollEl is guaranteed to be set by the time onMount runs (after first render).
    const el = scrollEl!;

    sticky = new StickToBottom(el);

    // Set CSS vars on the root element — single source from per-component specs
    for (const [k, v] of Object.entries(chatCssVars())) {
      el.style.setProperty(k, v);
    }

    // rAF-throttled scroll listener — coalesces multiple scroll events per frame
    // into a single signal write, mirroring the imperative engine's _scheduleFrame.
    // Also tracks scroll velocity for direction-aware overscan.
    let rafId: number | null = null;
    let lastScrollTop = 0;

    const flushScroll = () => {
      rafId = null;
      const st = el.scrollTop;
      setScrollVelocity(st - lastScrollTop);
      lastScrollTop = st;
      setScrollTop(st);
    };

    const onScroll = () => {
      // Ignore events fired while the element is detached (display:none resets
      // scrollTop to 0 without firing a real user scroll; let the saved signal
      // remain authoritative so the virtualizer position is preserved).
      if (el.offsetParent === null) return;
      // Ignore the event we triggered ourselves during anchor correction;
      // the scrollTop signal was already updated synchronously there.
      if (programmaticScroll) {
        programmaticScroll = false;
        return;
      }
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
    });

    // Viewport height comes from the full-width scroll container.
    const roHeight = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setViewHeight(h);
    });
    roHeight.observe(el);
    onCleanup(() => roHeight.disconnect());

    // Row width comes from the centered content column, which may be narrower
    // than the scroll container when the max-width cap is in effect.
    if (canvasEl) {
      const roWidth = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setContainerWidth(w);
      });
      roWidth.observe(canvasEl);
      onCleanup(() => roWidth.disconnect());
    }

    // Click delegation for collapse toggles
    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-collapse-id]') as HTMLElement | null;
      if (target?.dataset.collapseId) {
        props.viewState.toggleCollapsed(target.dataset.collapseId);
      }
    };
    el.addEventListener('click', onClick);
    onCleanup(() => el.removeEventListener('click', onClick));

    // Fonts ready — re-measure after webfonts load
    registerFontsReadyClear(() => {
      clearPretextCache();
      clearMessageLayoutCache();
      refreshTotal();
    });

    if (props.stickToBottom !== false) {
      sticky?.scrollToBottom();
    }

    onCleanup(() => {
      sticky?.dispose();
      sticky = null;
    });
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DebugContext.Provider value={debugValue}>
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
            {(rowIndex) => {
              // rowIndex is a stable row index for this DOM node's lifetime (<For>
              // is keyed by value), so the node persists while the row stays
              // visible and is disposed only when it scrolls out.
              const rowTop = createMemo(() => {
                totalHeight(); // re-read when heights change
                return virt.top(rowIndex) + padTop();
              });

              const item = createMemo(() => getItem(props.transcript.state, rowIndex));

              return (
                <Show when={item()}>
                  {/* `contain: layout paint style` isolates per-row recalc but
                      deliberately omits `size` so offsetHeight stays correct.
                      `content-visibility:auto` is intentionally avoided — it
                      blanks tall rows whose top sits above the viewport. */}
                  <div
                    class="absolute top-0 left-0 w-full will-change-transform [contain:layout_paint_style]"
                    style={{ transform: `translateY(${rowTop()}px)` }}
                    data-index={String(rowIndex)}
                  >
                    <Row
                      item={item()!}
                      index={rowIndex}
                      rowWidth={containerWidth()}
                      fonts={fonts()}
                      viewState={props.viewState}
                      virt={virt}
                      onHeightChanged={onHeightChanged}
                    />
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
      </div>
    </DebugContext.Provider>
  );
}

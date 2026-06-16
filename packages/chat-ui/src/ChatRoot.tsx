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
} from 'solid-js';
import { clearMessageLayoutCache } from './components/message/measure';
import { Row } from './components/Row';
import { DEFAULT_FONT_CONFIG } from './core/measure/fonts';
import type { FontConfig } from './core/measure/fonts';
import { clearPretextCache, registerFontsReadyClear } from './core/measure/pretext-cache';
import { metricsToCssVars } from './core/metrics';
import { StickToBottom } from './core/stick-to-bottom';
import { Virtualizer } from './core/virtualizer';
import type { ChatItem } from './model';
import { getItem, itemCount } from './state/transcript';
import type { TranscriptApi } from './state/transcript';
import type { ViewState } from './state/view-state';
import styles from './chat.module.css';

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
  class?: string;
};

function estimateHeight(item: ChatItem, fonts: FontConfig): number {
  if (item.kind === 'message') {
    // Quick estimate based on text length
    const lines = Math.ceil(item.text.length / 60);
    const lineH = fonts.body.lineHeight;
    return lineH * Math.max(1, lines) + 2 * fonts.bubblePadY + 8;
  }
  if (item.kind === 'tool') return 36;
  if (item.kind === 'thinking') return 28 + 72 + 8;
  return 60;
}

export function ChatRoot(props: ChatRootProps) {
  const fonts = () => props.fonts ?? DEFAULT_FONT_CONFIG;

  let scrollEl!: HTMLDivElement;
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
        return item ? estimateHeight(item, f) : 60;
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
    return virt.range(scrollTop(), viewHeight(), before, after);
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
    if (virt.top(index) < scrollEl.scrollTop) {
      const next = scrollEl.scrollTop + delta;
      programmaticScroll = true;
      scrollEl.scrollTop = next;
      setScrollTop(next);
    }
  };

  // ── DOM setup ─────────────────────────────────────────────────────────────

  onMount(() => {
    sticky = new StickToBottom(scrollEl);

    // Set CSS vars on the root element
    const cssVars = metricsToCssVars();
    for (const [k, v] of Object.entries(cssVars)) {
      scrollEl.style.setProperty(k, v);
    }

    // rAF-throttled scroll listener — coalesces multiple scroll events per frame
    // into a single signal write, mirroring the imperative engine's _scheduleFrame.
    // Also tracks scroll velocity for direction-aware overscan.
    let rafId: number | null = null;
    let lastScrollTop = 0;

    const flushScroll = () => {
      rafId = null;
      const st = scrollEl.scrollTop;
      setScrollVelocity(st - lastScrollTop);
      lastScrollTop = st;
      setScrollTop(st);
    };

    const onScroll = () => {
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
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => {
      scrollEl.removeEventListener('scroll', onScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    });

    // ResizeObserver
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w > 0) setContainerWidth(w);
      if (h > 0) setViewHeight(h);
    });
    ro.observe(scrollEl);
    onCleanup(() => ro.disconnect());

    // Click delegation for collapse toggles
    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-collapse-id]') as HTMLElement | null;
      if (target?.dataset.collapseId) {
        props.viewState.toggleCollapsed(target.dataset.collapseId);
      }
    };
    scrollEl.addEventListener('click', onClick);
    onCleanup(() => scrollEl.removeEventListener('click', onClick));

    // Fonts ready — re-measure after webfonts load
    registerFontsReadyClear(() => {
      clearPretextCache();
      clearMessageLayoutCache();
      refreshTotal();
    });

    if (props.stickToBottom !== false) {
      sticky.scrollToBottom();
    }

    onCleanup(() => {
      sticky?.dispose();
      sticky = null;
    });
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollEl}
      class={`${styles['pchat-transcript']}${props.class ? ` ${props.class}` : ''}`}
    >
      <div class={styles['pchat-canvas']} style={{ height: `${totalHeight()}px` }}>
        <For each={visibleIndexes()}>
          {(rowIndex) => {
            // rowIndex is a stable row index for this DOM node's lifetime (<For>
            // is keyed by value), so the node persists while the row stays
            // visible and is disposed only when it scrolls out.
            const rowTop = createMemo(() => {
              totalHeight(); // re-read when heights change
              return virt.top(rowIndex);
            });

            const item = createMemo(() => getItem(props.transcript.state, rowIndex));

            return (
              <Show when={item()}>
                <div
                  class={styles['pchat-row']}
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
  );
}

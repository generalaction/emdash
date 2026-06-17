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
import { REGISTRY } from './components/registry';
import { Row } from './components/Row';
import { ThemeContext } from './components/ThemeContext';
import { clearPretextCache, registerFontsReadyClear } from './core/measure/pretext-cache';
import { StickToBottom } from './core/stick-to-bottom';
import type { ChatTheme } from './core/theme';
import { DEFAULT_THEME } from './core/theme';
import { Virtualizer } from './core/virtualizer';
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
};

export function ChatRoot(props: ChatRootProps) {
  const theme = () => props.theme ?? DEFAULT_THEME;
  const contentClass = () => props.contentClass ?? DEFAULT_CONTENT_CLASS;

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

  const refreshTotal = () => {
    setTotalHeight(virt.total());
  };

  // ── Count sync effect ─────────────────────────────────────────────────────

  createEffect(() => {
    const n = itemCount(props.transcript.state);
    const t = theme();
    untrack(() => {
      virt.setCount(n, (i) => {
        const item = getItem(props.transcript.state, i);
        if (!item) return 60;
        const def = REGISTRY[item.kind as keyof typeof REGISTRY];
        return (
          def.estimate(item, {
            theme: t,
            width: 0,
            isCollapsed: () => false,
            measured: () => undefined,
          }) +
          2 * (t.geometry.rowPadY[item.kind] ?? 0)
        );
      });
      refreshTotal();
      if (props.stickToBottom !== false) sticky?.schedule();
    });
  });

  // ── Width change: flush text-measurement cache ───────────────────────────

  createEffect(() => {
    const w = containerWidth();
    if (w <= 0) return;
    clearPretextCache();
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

  // ── DOM setup ─────────────────────────────────────────────────────────────

  onMount(() => {
    const el = scrollEl!;

    sticky = new StickToBottom(el);

    // CSS vars required by CSS modules. Set once on mount (theme is not reactive
    // in the current architecture; if theme changes, a full unmount/remount is
    // expected). Groups:
    //   Typography — feed pretext measurement; keep until CSS modules migrate to --type-* vars.
    //   Inline code / mention chrome — feed pretext extra-width accounting.
    //   Code block geometry — feed Code.tsx visual chrome (padding, border).
    //   Island geometry — caps the max-height of fixed-size island blocks.
    const t = theme();
    const g = t.geometry;
    // Extract font-size px value from CSS shorthand "weight size family".
    const codeSizePx = t.fonts.code.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '13';
    const cssVars: Record<string, string> = {
      // Typography (--type-code-* equivalents that CSS modules reference as --chat-code-*)
      '--chat-code-size': `${codeSizePx}px`,
      '--chat-code-lh': `${t.fonts.code.lineHeight}px`,
      '--chat-code-weight': '400',
      // Inline code / mention chrome (feed pretext extra-width accounting)
      '--chat-ic-pad-x': `${g.inlineCodePadX}px`,
      '--chat-ic-pad-y': `${g.inlineCodePadY}px`,
      '--chat-mention-pad-x': `${Math.round(t.fonts.mentionExtraWidth / 2)}px`,
      // Code block geometry (visual chrome — border, padding)
      '--chat-code-border': `${g.codeBorder}px`,
      '--chat-code-pad-x': `${g.codePadX}px`,
      '--chat-code-pad-y': `${g.codePadY}px`,
      // Island geometry
      '--chat-island-max-h': `${g.islandFixedH}px`,
    };
    for (const [k, v] of Object.entries(cssVars)) {
      el.style.setProperty(k, v);
    }

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
      if (el.offsetParent === null) return;
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
      clearPretextCache();
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
      <ThemeContext.Provider value={theme}>
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
                const rowTop = createMemo(() => {
                  totalHeight();
                  return virt.top(rowIndex) + padTop();
                });

                const item = createMemo(() => getItem(props.transcript.state, rowIndex));
                const committedCount = () => props.transcript.state.committed.length;
                const isActiveTurn = () => rowIndex >= committedCount();

                return (
                  <Show when={item()}>
                    <div
                      class="absolute top-0 left-0 w-full will-change-transform [contain:layout_paint_style]"
                      style={{ transform: `translateY(${rowTop()}px)` }}
                      data-index={String(rowIndex)}
                    >
                      <Row
                        item={item()!}
                        index={rowIndex}
                        rowWidth={containerWidth()}
                        theme={theme()}
                        viewState={props.viewState}
                        virt={virt}
                        onHeightChanged={onHeightChanged}
                        isActiveTurn={isActiveTurn()}
                      />
                    </div>
                  </Show>
                );
              }}
            </For>
          </div>
        </div>
      </ThemeContext.Provider>
    </DebugContext.Provider>
  );
}

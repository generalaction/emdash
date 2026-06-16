import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef } from 'react';
import type { Block, IslandType } from '../blocks/block-types';
import { DEFAULT_FONT_CONFIG } from '../measure/fonts';
import type { FontConfig } from '../measure/fonts';
import { HeightModel } from '../measure/height-model';
import { registerFontsReadyClear } from '../measure/pretext-cache';
import { metricsToCssVars } from '../metrics';
import type { ChatMessage, ChatToolCall } from '../model';
import type { TranscriptStore } from '../state/transcript-store';
import { ViewStateStore } from '../state/view-state-store';
import { MessageRow } from './message-row';
import { ToolRow } from './tool-row';
import { useContentWidth } from './use-content-width';
import { useStickToBottom } from './use-stick-to-bottom';

/**
 * Slot injection interface — keeps the package dependency-free from KaTeX/Mermaid/Prism.
 * The app later injects real renderers; the package ships plain fallbacks.
 */
export type ChatSlots = {
  /** Override code block rendering (default: `<pre>`). */
  renderCode?: (block: Block & { tier: 'code' }) => React.ReactNode;
  /** Override island rendering per type (default: plain fallbacks). */
  renderIsland?: Partial<
    Record<IslandType, (block: Block & { tier: 'island' }) => React.ReactNode>
  >;
  /** Override mention chip rendering. */
  renderMention?: (label: string, tone?: string) => React.ReactNode;
};

export type ChatTranscriptProps = {
  store: TranscriptStore;
  /** Override fonts/metrics (must match CSS). Defaults to DEFAULT_FONT_CONFIG. */
  fonts?: FontConfig;
  slots?: ChatSlots;
  stickToBottom?: boolean;
  className?: string;
};

/**
 * ChatTranscript — the main public component.
 *
 * Renders a virtualised, scrollable list of chat items using TanStack Virtual.
 * Height estimation is delegated to HeightModel (pretext-backed for prose,
 * line-count for code, fixed for islands).  measureElement is kept active as a
 * self-healing net for drift correction.
 */
export const ChatTranscript = observer(function ChatTranscript({
  store,
  fonts = DEFAULT_FONT_CONFIG,
  slots,
  stickToBottom = true,
  className,
}: ChatTranscriptProps) {
  const items = store.items;

  // ── Persistent stores (not recreated on re-renders) ───────────────────────
  const heightModel = useMemo(() => new HeightModel(fonts), [fonts]);
  const viewState = useMemo(() => new ViewStateStore(), []);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const [scrollRef, contentWidth] = useContentWidth();
  const [stickyContainerRef, scheduleScrollCheck] = useStickToBottom();

  // Combine refs for the scroll container
  const containerCallbackRef = (el: HTMLElement | null) => {
    scrollRef(el);
    (stickyContainerRef as React.MutableRefObject<HTMLElement | null>).current = el;
  };

  // ── Virtualizer ───────────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  // Stable refs so fonts-ready closure can access latest values without deps
  const heightModelRef = useRef(heightModel);
  const contentWidthRef = useRef(contentWidth);
  heightModelRef.current = heightModel;
  contentWidthRef.current = contentWidth;

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => parentRef.current,
    // Cheap heuristic — no markdown parse, O(text.length) at most.
    // Visible rows are corrected to DOM heights via the default ResizeObserver
    // measureElement path (ref={virtualizer.measureElement} on each row div).
    estimateSize: (index) => {
      const item = items[index];
      if (!item) return 60;
      return heightModel.estimateItemHeight(item);
    },
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 8,
    // measureElement is intentionally omitted here so TanStack uses its default
    // getBoundingClientRect path.  A custom function that calls MobX-tracked
    // methods (heightModel.itemHeight) inside TanStack's flushSync-wrapped
    // ResizeObserver callback can trigger MobX → React re-render loops.
    // getBoundingClientRect only fires for the ~10–20 mounted rows, not all
    // 10k, so there is no init-time reflow concern.
  });

  // Update HeightModel when width changes
  useEffect(() => {
    if (contentWidth > 0) {
      heightModel.resetForWidth(contentWidth);
    }
  }, [contentWidth, heightModel]);

  // Register fonts-ready cache clear once on mount (stable refs avoid stale closure)
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  useEffect(() => {
    registerFontsReadyClear(() => {
      const hm = heightModelRef.current;
      const w = contentWidthRef.current;
      hm.resetForWidth(0);
      if (w > 0) hm.resetForWidth(w);
      virtualizerRef.current.measure();
    });
    // Intentionally run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger stick-to-bottom check when item count grows
  useEffect(() => {
    if (stickToBottom) scheduleScrollCheck();
  }, [items.length, stickToBottom, scheduleScrollCheck]);

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const isScrolling = virtualizer.isScrolling;

  // CSS variables derived from the same metrics used in HeightModel — single source of truth.
  const cssVars = useMemo(() => metricsToCssVars(), []);

  return (
    <div
      ref={(el) => {
        // Merge parentRef and containerCallbackRef
        (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        containerCallbackRef(el);
      }}
      className={`chat-transcript${className ? ` ${className}` : ''}`}
      style={cssVars as React.CSSProperties}
    >
      <div className="chat-canvas" style={{ height: totalSize }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (!item) return null;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="chat-row"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
                // Matches the row's estimated height so content-visibility:auto
                // has an accurate intrinsic-size hint for offscreen layout skipping.
                containIntrinsicSize: `0 ${virtualItem.size}px`,
              }}
            >
              {item.kind === 'message' ? (
                <MessageRow
                  item={item as ChatMessage}
                  viewState={viewState}
                  heightModel={heightModel}
                  slots={slots}
                  isScrolling={isScrolling}
                  onHeightChange={() => {
                    // Island setMeasured already cleared the item cache; now tell
                    // the virtualizer to recompute positions with the new heights.
                    virtualizerRef.current.measure();
                    scheduleScrollCheck();
                  }}
                />
              ) : (
                <ToolRow item={item as ChatToolCall} viewState={viewState} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

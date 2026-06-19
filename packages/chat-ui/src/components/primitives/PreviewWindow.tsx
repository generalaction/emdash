/**
 * PreviewWindow — standalone scrollable preview container.
 *
 * Extracted from ProjectWindow (Project.tsx) so native UnitDef Renders can use
 * it without the compose-tree machinery. Accepts explicit height + maxH (both px)
 * and renders children in a clipped, optionally auto-scrolling window with an
 * optional fade overlay.
 *
 * Used by thinking and plan Renders for the collapsed-active preview state.
 */

import { Show, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';

export type PreviewWindowProps = {
  /** Outer container height (px). */
  height: number;
  /** Maximum scrollable area height (px). */
  maxH: number;
  overlay?: 'fade-top' | 'fade-bottom';
  /**
   * When true, scroll the container to the bottom whenever `contentHeight` changes.
   * Use for streaming content that grows from the bottom.
   */
  autoScrollBottom?: boolean;
  /**
   * Reactive accessor whose value changes whenever content grows. When
   * `autoScrollBottom` is true, changing this value triggers a scroll-to-bottom.
   * Pass `() => item.text?.length` or similar growing signal.
   */
  contentHeight?: () => number;
  children: JSX.Element;
};

export function PreviewWindow(props: PreviewWindowProps): JSX.Element {
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.autoScrollBottom) return;
    // Track contentHeight to retrigger on every content-growth tick.
    props.contentHeight?.();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  onCleanup(() => {
    scrollEl = undefined;
  });

  return (
    <div
      style={{
        height: `${props.height}px`,
        'max-height': `${props.maxH}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Show when={props.overlay}>
        <div
          class={
            props.overlay === 'fade-top'
              ? 'fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10'
              : 'fade-overlay-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10'
          }
          style={{ height: '28px' }}
          aria-hidden="true"
        />
      </Show>
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        style={{
          'max-height': `${props.maxH}px`,
          overflow: props.autoScrollBottom ? 'auto' : 'hidden',
          'scrollbar-gutter': props.autoScrollBottom ? 'stable' : undefined,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

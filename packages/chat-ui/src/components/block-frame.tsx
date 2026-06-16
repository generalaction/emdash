/**
 * BlockFrame / MeasuredBlockFrame — reusable absolute-position wrappers for
 * block-level content inside a message bubble.
 *
 * Block components (Code, Prose, Island) should use these instead of
 * hand-writing `position: absolute; top; height; left: 0; right: 0` inline
 * styles.  Placement lives here; components only describe content.
 *
 * BlockFrame        — exact geometry from the layout engine (no DOM measurement)
 * MeasuredBlockFrame — opt-in for islands / thinking bodies that need a real
 *                      DOM write-back after mount (ResizeObserver).
 */

import { type JSX, onCleanup, onMount } from 'solid-js';
import styles from './block-frame.module.css';

// ── BlockFrame ────────────────────────────────────────────────────────────────

export type BlockFrameProps = {
  layout: { top: number; height: number };
  class?: string;
  ref?: (el: HTMLElement) => void;
  children: JSX.Element;
};

/**
 * Pure positioning wrapper.  Renders a `position: absolute` div sized and
 * placed by the pre-computed layout geometry.  The `.pblock` base class (from
 * the block-frame module) provides `position: absolute; left: 0; width: 100%`.
 * Pass an additional `class` for block-kind-specific visual styling.
 */
export function BlockFrame(props: BlockFrameProps) {
  return (
    <div
      ref={props.ref}
      class={`${styles.pblock}${props.class ? ` ${props.class}` : ''}`}
      style={{
        top: `${props.layout.top}px`,
        height: `${props.layout.height}px`,
        left: '0',
        right: '0',
      }}
    >
      {props.children}
    </div>
  );
}

// ── MeasuredBlockFrame ────────────────────────────────────────────────────────

export type MeasuredBlockFrameProps = {
  layout: { top: number; height: number };
  id: string;
  class?: string;
  onMeasured: (id: string, height: number) => void;
  children: JSX.Element;
};

/**
 * Positioning wrapper that also measures its content height after mount and
 * reports it via `onMeasured(id, height)`.  Use for blocks whose height is
 * unknown at layout time (islands, thinking bodies).
 *
 * Implements the write-back with a ResizeObserver (falls back to rAF) so that
 * content that loads asynchronously (images, lazy math) also triggers a
 * re-measure.  The observer is disconnected on cleanup.
 */
export function MeasuredBlockFrame(props: MeasuredBlockFrameProps) {
  let el!: HTMLElement;

  onMount(() => {
    const report = () => {
      const h = el?.scrollHeight ?? 0;
      if (h > 0) props.onMeasured(props.id, h);
    };

    const ro = new ResizeObserver(report);
    ro.observe(el);
    onCleanup(() => ro.disconnect());

    // Also fire once immediately via rAF so the initial height is reported
    // even before a resize event.
    requestAnimationFrame(report);
  });

  return (
    <div
      ref={(e) => {
        el = e;
      }}
      class={`${styles.pblock}${props.class ? ` ${props.class}` : ''}`}
      style={{
        top: `${props.layout.top}px`,
        left: '0',
        right: '0',
      }}
    >
      {props.children}
    </div>
  );
}

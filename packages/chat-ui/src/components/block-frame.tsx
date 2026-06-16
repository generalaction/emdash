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
 *
 * Debug overlay: when the DebugContext is enabled, a dashed blue boundary is
 * drawn over the engine-reserved box. If the real DOM height diverges from the
 * reserved height by more than 0.5px the outline turns red and shows both values.
 */

import { Show, createSignal, onMount, type JSX, onCleanup } from 'solid-js';
import { useDebug } from './debug-context';
import styles from './block-frame.module.css';

// ── Debug overlay ─────────────────────────────────────────────────────────────

type DebugOverlayProps = {
  id?: string;
  reservedHeight: number;
  elRef: () => HTMLElement | undefined;
};

function DebugOverlay(props: DebugOverlayProps) {
  const [mismatch, setMismatch] = createSignal(false);
  const [actualH, setActualH] = createSignal(0);

  onMount(() => {
    const el = props.elRef();
    if (!el) return;
    const check = () => {
      const h = el.scrollHeight;
      setActualH(h);
      setMismatch(Math.abs(h - props.reservedHeight) > 0.5);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
    requestAnimationFrame(check);
  });

  return (
    <div
      class="pointer-events-none absolute inset-0 outline outline-1 outline-dashed"
      classList={{
        'outline-red-500': mismatch(),
        'outline-sky-400/60': !mismatch(),
      }}
    >
      <span class="absolute right-0 top-0 bg-black/70 px-1 text-[10px] leading-tight text-white">
        {props.id ? `${props.id} · ` : ''}h={props.reservedHeight}
        <Show when={mismatch()}>
          {' '}
          <span class="text-red-400">
            ⚠ actual={actualH()} (+{actualH() - props.reservedHeight})
          </span>
        </Show>
      </span>
    </div>
  );
}

// ── BlockFrame ────────────────────────────────────────────────────────────────

export type BlockFrameProps = {
  layout: { top: number; height: number; id?: string };
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
  const debug = useDebug(); // () => boolean — reactive accessor
  let el: HTMLElement | undefined;

  return (
    <div
      ref={(e) => {
        el = e;
        props.ref?.(e);
      }}
      class={`${styles.pblock}${props.class ? ` ${props.class}` : ''}`}
      style={{
        top: `${props.layout.top}px`,
        height: `${props.layout.height}px`,
        left: '0',
        right: '0',
      }}
    >
      {props.children}
      <Show when={debug()}>
        <DebugOverlay
          id={(props.layout as { id?: string }).id}
          reservedHeight={props.layout.height}
          elRef={() => el}
        />
      </Show>
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
  const debug = useDebug(); // () => boolean — reactive accessor
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
      <Show when={debug()}>
        <DebugOverlay
          id={props.id}
          reservedHeight={props.layout.height}
          elRef={() => el}
        />
      </Show>
    </div>
  );
}

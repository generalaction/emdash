/**
 * Row — generic row dispatcher driven by ROW_REGISTRY.
 *
 * Owns the virtualizer height bridge: computes exact layout via the row spec's
 * `measure()`, writes the height into the Fenwick tree via `virt.setSize`, and
 * delegates rendering to the spec's `Render` component via <Dynamic>.
 *
 * Per-row state:
 *   measured  — DOM-measured heights for islands and thinking bodies, written
 *               back by the Render component through ctx.setMeasured.
 *
 * Rendered via <For> keyed by row index, so each Row instance owns a fixed row
 * index for its lifetime — no slot recycling, no cross-row state contamination.
 *
 * Debug overlay: when DebugContext is enabled, a dashed boundary is drawn over
 * the full row at the virtualizer-reserved height. A red boundary + label means
 * the rendered height differs from what the engine reserved — a sure sign that
 * CSS is adding unexpected geometry.
 */

import { Dynamic } from 'solid-js/web';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { FontConfig } from '../core/measure/fonts';
import type { MeasureCtx, RenderCtx } from '../core/layout/spec-types';
import type { Virtualizer } from '../core/virtualizer';
import type { ChatItem } from '../model';
import type { ViewState } from '../state/view-state';
import { useDebug } from './debug-context';
import { ROW_REGISTRY } from './row-registry';

export type RowProps = {
  item: ChatItem;
  index: number;
  rowWidth: number;
  fonts?: FontConfig;
  viewState: ViewState;
  virt: Virtualizer;
  onHeightChanged: (index: number, delta: number) => void;
};

// ── Row-level debug overlay ────────────────────────────────────────────────────

function RowDebugOverlay(props: { reservedHeight: number; rowEl: () => HTMLElement | undefined }) {
  const [mismatch, setMismatch] = createSignal(false);
  const [actualH, setActualH] = createSignal(0);

  onMount(() => {
    const el = props.rowEl();
    if (!el) return;

    const check = () => {
      const h = el.offsetHeight;
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
      class="pointer-events-none absolute inset-x-0 top-0 outline outline-1 outline-dashed"
      style={{ height: `${props.reservedHeight}px` }}
      classList={{
        'outline-red-500/80': mismatch(),
        'outline-emerald-400/50': !mismatch(),
      }}
    >
      <span class="absolute left-0 top-0 bg-black/70 px-1 text-[9px] leading-tight text-white">
        row · h={props.reservedHeight}
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

// ── Row ───────────────────────────────────────────────────────────────────────

export function Row(props: RowProps) {
  const debug = useDebug();
  const fonts = () => props.fonts ?? DEFAULT_FONT_CONFIG;

  // DOM-measured heights for islands and thinking bodies.
  const [measured, setMeasured] = createStore<Record<string, number>>({});

  let rowEl: HTMLElement | undefined;

  // ── Contexts ─────────────────────────────────────────────────────────────────

  const measureCtx = (): MeasureCtx => ({
    fonts: fonts(),
    rowWidth: props.rowWidth,
    isCollapsed: (id) => props.viewState.isCollapsed(id),
    measured: (id) => measured[id],
  });

  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: (id) => props.viewState.isCollapsed(id) },
    setMeasured: (id, h) => setMeasured(id, h),
  };

  // ── Spec lookup ───────────────────────────────────────────────────────────────

  const spec = createMemo(() => ROW_REGISTRY[props.item.kind]);

  // ── Layout + height bridge ────────────────────────────────────────────────────

  const layout = createMemo(() => spec().measure(props.item, measureCtx()));

  createEffect(() => {
    const delta = props.virt.setSize(props.index, layout().height);
    if (delta !== 0) props.onHeightChanged(props.index, delta);
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={(e) => {
        rowEl = e;
      }}
      style={{ position: 'relative' }}
    >
      <Dynamic
        component={spec().Render}
        item={props.item}
        layout={layout()}
        ctx={renderCtx}
      />
      <Show when={debug}>
        <RowDebugOverlay reservedHeight={layout().height} rowEl={() => rowEl} />
      </Show>
    </div>
  );
}

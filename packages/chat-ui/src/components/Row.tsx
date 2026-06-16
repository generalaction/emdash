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
 */

import { Dynamic } from 'solid-js/web';
import { createEffect, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { FontConfig } from '../core/measure/fonts';
import type { MeasureCtx, RenderCtx } from '../core/layout/spec-types';
import type { Virtualizer } from '../core/virtualizer';
import type { ChatItem } from '../model';
import type { ViewState } from '../state/view-state';
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

export function Row(props: RowProps) {
  const fonts = () => props.fonts ?? DEFAULT_FONT_CONFIG;

  // DOM-measured heights for islands and thinking bodies.
  const [measured, setMeasured] = createStore<Record<string, number>>({});

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
    <Dynamic
      component={spec().Render}
      item={props.item}
      layout={layout()}
      ctx={renderCtx}
    />
  );
}

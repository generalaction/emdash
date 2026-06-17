/**
 * executeRow — RowComponent for ChatExecute.
 *
 * estimate / measure: constant EXEC_ROW_H + ROW_GAP (no collapse state).
 * Render:            Execute component (no props beyond item).
 * cssVars:           execute row height constant.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatExecute } from '../../model';
import { Execute } from './Execute';
import { measureExecute } from './measure';

export { execCssVars } from './css-vars';

export type ExecuteRowLayout = { height: number };

function ExecuteRender(props: { item: ChatExecute; layout: ExecuteRowLayout; ctx: RenderCtx }) {
  // layout.height is consumed by the virtualizer; ctx provides view state not needed here.
  void props.layout;
  void props.ctx;
  return <Execute item={props.item} />;
}

export const executeRow: RowComponent<ChatExecute, ExecuteRowLayout> = {
  estimate(item: ChatExecute, _ctx: MeasureCtx): number {
    return measureExecute(item);
  },

  measure(item: ChatExecute, _ctx: MeasureCtx): ExecuteRowLayout {
    return { height: measureExecute(item) };
  },

  Render: ExecuteRender as Component<{
    item: ChatExecute;
    layout: ExecuteRowLayout;
    ctx: RenderCtx;
  }>,
};

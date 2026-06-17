/**
 * executeRow — RowComponent for ChatExecute.
 *
 * estimate / measure: both call measureExecute (pure arithmetic, no pretext).
 * Render:            Execute component.
 * cssVars:           execute layout constants.
 *
 * Collapse semantics are inverted (same as file-op and thinking rows): the
 * stored "collapsed" bool means "expanded" — default absent/false → collapsed.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatExecute } from '../../model';
import { Execute } from './Execute';
import { measureExecute } from './measure';

export { execCssVars } from './css-vars';

export type ExecuteRowLayout = { height: number };

function ExecuteRender(props: { item: ChatExecute; layout: ExecuteRowLayout; ctx: RenderCtx }) {
  return <Execute item={props.item} collapsed={props.ctx.viewState.isCollapsed(props.item.id)} />;
}

export const executeRow: RowComponent<ChatExecute, ExecuteRowLayout> = {
  estimate(item: ChatExecute, ctx: MeasureCtx): number {
    return measureExecute(item, ctx.isCollapsed);
  },

  measure(item: ChatExecute, ctx: MeasureCtx): ExecuteRowLayout {
    return { height: measureExecute(item, ctx.isCollapsed) };
  },

  Render: ExecuteRender as Component<{
    item: ChatExecute;
    layout: ExecuteRowLayout;
    ctx: RenderCtx;
  }>,
};

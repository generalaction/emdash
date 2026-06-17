/**
 * fileOpRow — RowComponent for ChatFileOpToolCall.
 *
 * estimate / measure: both call measureFileOp (pure arithmetic, no pretext).
 * Render:            FileOperation component.
 * cssVars:           file-op layout constants.
 *
 * Collapse semantics are inverted (same as thinking rows): the stored
 * "collapsed" bool means "expanded" — default absent/false → collapsed.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatFileOpToolCall } from '../../model';
import { FileOperation } from './FileOperation';
import { measureFileOp } from './measure';

export { fileOpCssVars } from './css-vars';

export type FileOpRowLayout = { height: number };

function FileOpRender(props: {
  item: ChatFileOpToolCall;
  layout: FileOpRowLayout;
  ctx: RenderCtx;
}) {
  return (
    <FileOperation item={props.item} collapsed={props.ctx.viewState.isCollapsed(props.item.id)} />
  );
}

export const fileOpRow: RowComponent<ChatFileOpToolCall, FileOpRowLayout> = {
  estimate(item: ChatFileOpToolCall, ctx: MeasureCtx): number {
    // isCollapsed serves as isExpanded here — see measure.ts for the inversion rationale.
    return measureFileOp(item, ctx.isCollapsed);
  },

  measure(item: ChatFileOpToolCall, ctx: MeasureCtx): FileOpRowLayout {
    return { height: measureFileOp(item, ctx.isCollapsed) };
  },

  Render: FileOpRender as Component<{
    item: ChatFileOpToolCall;
    layout: FileOpRowLayout;
    ctx: RenderCtx;
  }>,
};

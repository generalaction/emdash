/**
 * toolRow — RowComponent for ChatToolCall.
 *
 * measure / estimate: both call measureTool (pure arithmetic, no pretext)
 * Render:             Tool component
 * cssVars:            tool row height
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatToolCall } from '../../model';
import { measureTool } from './measure';
import { TOOL_ROW_H } from './metrics';
import { Tool } from './Tool';

export type ToolRowLayout = { height: number };

function ToolRender(props: { item: ChatToolCall; layout: ToolRowLayout; ctx: RenderCtx }) {
  return <Tool item={props.item} collapsed={props.ctx.viewState.isCollapsed(props.item.id)} />;
}

export const toolRow: RowComponent<ChatToolCall, ToolRowLayout> = {
  estimate(item: ChatToolCall, ctx: MeasureCtx): number {
    return measureTool(item, ctx.isCollapsed);
  },

  measure(item: ChatToolCall, ctx: MeasureCtx): ToolRowLayout {
    return { height: measureTool(item, ctx.isCollapsed) };
  },

  Render: ToolRender as Component<{ item: ChatToolCall; layout: ToolRowLayout; ctx: RenderCtx }>,
};

export function toolCssVars(): Record<string, string> {
  return {
    '--chat-tool-row-h': `${TOOL_ROW_H}px`,
  };
}

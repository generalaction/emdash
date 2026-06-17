/**
 * toolRow — RowComponent for ChatToolCall.
 *
 * estimate / measure: constant TOOL_ROW_H + ROW_GAP (no collapse state).
 * Render:            Tool component (no props beyond item).
 * cssVars:           tool row height constant.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatToolCall } from '../../model';
import { measureTool } from './measure';
import { TOOL_ROW_H } from './metrics';
import { Tool } from './Tool';

export type ToolRowLayout = { height: number };

function ToolRender(props: { item: ChatToolCall; layout: ToolRowLayout; ctx: RenderCtx }) {
  void props.layout;
  void props.ctx;
  return <Tool item={props.item} />;
}

export const toolRow: RowComponent<ChatToolCall, ToolRowLayout> = {
  estimate(item: ChatToolCall, _ctx: MeasureCtx): number {
    return measureTool(item);
  },

  measure(item: ChatToolCall, _ctx: MeasureCtx): ToolRowLayout {
    return { height: measureTool(item) };
  },

  Render: ToolRender as Component<{ item: ChatToolCall; layout: ToolRowLayout; ctx: RenderCtx }>,
};

export function toolCssVars(): Record<string, string> {
  return {
    '--chat-tool-row-h': `${TOOL_ROW_H}px`,
  };
}

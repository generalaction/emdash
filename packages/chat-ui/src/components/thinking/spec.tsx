/**
 * thinkingRow — RowComponent for ChatThinking.
 *
 * measure / estimate: both call measureThinking (pure arithmetic, no pretext)
 * Render:             Thinking component, wired to ctx.setMeasured for body write-back
 * cssVars:            thinking layout constants
 *
 * Collapse semantics are inverted for thinking rows: the stored "collapsed" bool
 * is treated as "expanded" — see measure.ts and Thinking.tsx for rationale.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatThinking } from '../../model';
import { measureThinking } from './measure';
import { THINKING_FADE_H, THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';
import { Thinking } from './Thinking';

export type ThinkingRowLayout = { height: number; bodyH?: number };

function ThinkingRender(props: { item: ChatThinking; layout: ThinkingRowLayout; ctx: RenderCtx }) {
  const onBodyMeasured = (id: string, h: number) => props.ctx.setMeasured(id, h);
  return (
    <Thinking
      item={props.item}
      collapsed={props.ctx.viewState.isCollapsed(props.item.id)}
      onBodyMeasured={onBodyMeasured}
      bodyMeasuredHeight={props.layout.bodyH}
    />
  );
}

export const thinkingRow: RowComponent<ChatThinking, ThinkingRowLayout> = {
  estimate(item: ChatThinking, ctx: MeasureCtx): number {
    // isCollapsed serves as isExpanded here — see measure.ts for the inversion rationale.
    return measureThinking(item, ctx.isCollapsed, ctx.measured(item.id));
  },

  measure(item: ChatThinking, ctx: MeasureCtx): ThinkingRowLayout {
    const bodyH = ctx.measured(item.id);
    return { height: measureThinking(item, ctx.isCollapsed, bodyH), bodyH };
  },

  Render: ThinkingRender as Component<{
    item: ChatThinking;
    layout: ThinkingRowLayout;
    ctx: RenderCtx;
  }>,
};

export function thinkingCssVars(): Record<string, string> {
  return {
    '--chat-think-header-h': `${THINKING_HEADER_H}px`,
    '--chat-think-window-h': `${THINKING_WINDOW_H}px`,
    '--chat-think-fade-h': `${THINKING_FADE_H}px`,
    '--chat-think-pad-y': `${THINKING_PAD_Y}px`,
  };
}

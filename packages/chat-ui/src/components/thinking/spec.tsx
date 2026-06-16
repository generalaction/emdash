/**
 * thinkingRow — RowComponent for ChatThinking.
 *
 * measure / estimate: both call measureThinking (pure arithmetic, no pretext)
 * Render:             Thinking component, wired to ctx.setMeasured for body write-back
 * cssVars:            thinking layout constants
 */

import type { Component } from 'solid-js';
import { measureThinking } from './measure';
import { Thinking } from './Thinking';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatThinking } from '../../model';
import { THINKING_FADE_H, THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export type ThinkingRowLayout = { height: number };

function ThinkingRender(props: { item: ChatThinking; layout: ThinkingRowLayout; ctx: RenderCtx }) {
  const onBodyMeasured = (id: string, h: number) => props.ctx.setMeasured(id, h);
  return (
    <Thinking
      item={props.item}
      collapsed={props.ctx.viewState.isCollapsed(props.item.id)}
      onBodyMeasured={onBodyMeasured}
    />
  );
}

export const thinkingRow: RowComponent<ChatThinking, ThinkingRowLayout> = {
  estimate(item: ChatThinking, ctx: MeasureCtx): number {
    return measureThinking(item, ctx.isCollapsed, ctx.measured(item.id));
  },

  measure(item: ChatThinking, ctx: MeasureCtx): ThinkingRowLayout {
    return { height: measureThinking(item, ctx.isCollapsed, ctx.measured(item.id)) };
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

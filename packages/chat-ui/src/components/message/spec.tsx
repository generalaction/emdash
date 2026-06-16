/**
 * messageRow — RowComponent for ChatMessage.
 *
 * measure:   exact layout via layoutMessage (calls pretext for prose blocks)
 * estimate:  O(1) heuristic — line-count guess, no pretext
 * Render:    Message component
 * cssVars:   bubble padding and block gap
 */

import type { Component } from 'solid-js';
import { measureMessage } from './measure';
import { Message } from './Message';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { MessageLayout } from '../../core/layout/layout-types';
import type { ChatMessage } from '../../model';
import { ROW_GAP } from '../../core/metrics';
import { BUBBLE_PAD_Y } from './metrics';
export { BUBBLE_PAD_X, BUBBLE_PAD_Y, BLOCK_GAP, messageCssVars } from './css-vars';

export type MessageRowLayout = MessageLayout;

function MessageRender(props: { item: ChatMessage; layout: MessageRowLayout; ctx: RenderCtx }) {
  const onIslandMeasured = (id: string, h: number) => props.ctx.setMeasured(id, h);
  return <Message item={props.item} layout={props.layout} onIslandMeasured={onIslandMeasured} />;
}

export const messageRow: RowComponent<ChatMessage, MessageRowLayout> = {
  estimate(item: ChatMessage, ctx: MeasureCtx): number {
    // Cheap heuristic: estimate line count from text length, add bubble chrome.
    // Must NOT call layoutMessage / pretext — this runs for all N rows at setCount.
    const lines = Math.ceil(item.text.length / 60);
    const lineH = ctx.fonts.body.lineHeight;
    return lineH * Math.max(1, lines) + 2 * BUBBLE_PAD_Y + ROW_GAP + 8;
  },

  measure(item: ChatMessage, ctx: MeasureCtx): MessageRowLayout {
    return measureMessage(
      item,
      ctx.rowWidth,
      ctx.fonts,
      ctx.isCollapsed,
      ctx.measured
    );
  },

  Render: MessageRender as Component<{ item: ChatMessage; layout: MessageRowLayout; ctx: RenderCtx }>,
};


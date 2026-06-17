/**
 * messageDef — ComponentDef for ChatMessage rows.
 *
 * estimate:  O(1) character-count heuristic; no pretext.
 * measure:   exact layout via layoutMessage (uses pretext for prose blocks).
 *
 * The bespoke message LRU cache (clearMessageLayoutCache) is replaced by the
 * identity-based node memo in registry.ts (phase 6). The `layoutMessage` and
 * `measureMessage` helpers are still called here; those layout functions remain
 * in message/layout.ts and message/measure.ts while this def coordinates them.
 */

import type { Component } from 'solid-js';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { MessageLayout } from '../../core/layout/layout-types';
import type { ChatMessage } from '../../model';
import { measureMessage } from './measure';
import { Message } from './Message';

export type MessageNodeLayout = MessageLayout & { kind: 'message' };

function MessageRender(props: {
  item: ChatMessage;
  layout: Measured<MessageNodeLayout>;
  ctx: RenderCtx;
}) {
  const onIslandMeasured = (id: string, h: number) => props.ctx.setMeasured(id, h);
  return (
    <Message item={props.item} layout={props.layout.layout} onIslandMeasured={onIslandMeasured} />
  );
}

export const messageDef = defineComponent<ChatMessage, MessageNodeLayout>({
  kind: 'message',

  estimate(item, ctx: MeasureCtx): number {
    const lines = Math.ceil(item.text.length / 60);
    const lineH = ctx.theme.fonts.body.lineHeight;
    const { bubblePadY, messageFooterH } = ctx.theme.geometry;
    const footer = item.role === 'assistant' ? messageFooterH : 0;
    return lineH * Math.max(1, lines) + 2 * bubblePadY + footer + 8;
  },

  measure(item, ctx: MeasureCtx): Measured<MessageNodeLayout> {
    const layout = measureMessage(item, ctx.width, ctx.theme.fonts, ctx.isCollapsed, ctx.measured);
    return {
      height: layout.height,
      width: layout.width,
      layout: { ...layout, kind: 'message' },
    };
  },

  Render: MessageRender as Component<{
    item: ChatMessage;
    layout: Measured<MessageNodeLayout>;
    ctx: RenderCtx;
  }>,
});

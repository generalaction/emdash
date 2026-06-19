/**
 * toolDef — ComponentDef for ChatToolCall rows.
 *
 * Height is one body line-height. No collapse state.
 */

import { defineComponent, type Measured, type RenderCtx } from '../../core/define';
import { ROW_H } from '../../core/metrics';
import type { ChatToolCall } from '../../model';
import { Tool } from './Tool';

export type ToolLayout = { kind: 'tool' };

function ToolRender(props: { item: ChatToolCall; layout: Measured<ToolLayout>; ctx: RenderCtx }) {
  return (
    <div
      class="border-chat-border flex items-center"
      style={{ height: `${props.layout.height}px` }}
    >
      <Tool item={props.item} />
    </div>
  );
}

export const toolDef = defineComponent<ChatToolCall, ToolLayout>({
  kind: 'tool',

  estimate(): number {
    return ROW_H;
  },

  measure(_item, ctx): Measured<ToolLayout> {
    return {
      height: ROW_H,
      width: ctx.width,
      layout: { kind: 'tool' },
    };
  },

  Render: ToolRender,
});

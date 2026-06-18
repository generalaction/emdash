/**
 * toolDef — ComponentDef for ChatToolCall rows.
 *
 * Height is one body line-height. No collapse state.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatToolCall } from '../../model';
import { Tool } from './Tool';

export type ToolLayout = { kind: 'tool' };

function ToolRender(props: { item: ChatToolCall; layout: Measured<ToolLayout>; ctx: RenderCtx }) {
  return (
    <div
      style={{
        height: `${props.layout.height}px`,
        display: 'flex',
        'align-items': 'center',
      }}
    >
      <Tool item={props.item} />
    </div>
  );
}

export const toolDef = defineComponent<ChatToolCall, ToolLayout>({
  kind: 'tool',

  estimate(_item, ctx: MeasureCtx): number {
    return ctx.theme.fonts.body.lineHeight;
  },

  measure(_item, ctx: MeasureCtx): Measured<ToolLayout> {
    return {
      height: ctx.theme.fonts.body.lineHeight,
      width: ctx.width,
      layout: { kind: 'tool' },
    };
  },

  Render: ToolRender,
});

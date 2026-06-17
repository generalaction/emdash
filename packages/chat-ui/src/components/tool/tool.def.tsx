/**
 * toolDef — ComponentDef for ChatToolCall rows.
 *
 * Height is `toolRowH` from the theme geometry (= body lineHeight; formerly
 * TOOL_ROW_H in tool/metrics.ts).  No collapse state.
 *
 * The Render wrapper applies row geometry (height, horizontal padding) via
 * inline styles so tool.module.css no longer needs geometry CSS vars.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatToolCall } from '../../model';
import { useTheme } from '../ThemeContext';
import { Tool } from './Tool';

export type ToolLayout = { kind: 'tool' };

function ToolRender(props: { item: ChatToolCall; layout: Measured<ToolLayout>; ctx: RenderCtx }) {
  const theme = useTheme();
  const g = () => theme().geometry;

  return (
    <div
      style={{
        height: `${props.layout.height}px`,
        padding: `0 ${g().rowInsetX}px`,
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
    return ctx.theme.geometry.toolRowH;
  },

  measure(_item, ctx: MeasureCtx): Measured<ToolLayout> {
    return {
      height: ctx.theme.geometry.toolRowH,
      width: ctx.width,
      layout: { kind: 'tool' },
    };
  },

  Render: ToolRender,
});

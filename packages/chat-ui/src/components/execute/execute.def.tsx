/**
 * executeDef — ComponentDef for ChatExecute rows.
 *
 * Height is always a fixed `execRowH` from the theme geometry (formerly
 * the EXEC_ROW_H constant in execute/metrics.ts).  No collapse state.
 *
 * The Render wrapper applies row geometry (height, horizontal padding) via
 * inline styles so execute.module.css no longer needs geometry CSS vars.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatExecute } from '../../model';
import { useTheme } from '../ThemeContext';
import { Execute } from './Execute';

export type ExecuteLayout = { kind: 'execute' };

function ExecuteRender(props: {
  item: ChatExecute;
  layout: Measured<ExecuteLayout>;
  ctx: RenderCtx;
}) {
  const theme = useTheme();
  const g = () => theme().geometry;

  return (
    <div
      style={{
        height: `${props.layout.height}px`,
        'padding-inline': `${g().rowInsetX}px`,
        display: 'flex',
        'align-items': 'center',
      }}
    >
      <Execute item={props.item} />
    </div>
  );
}

export const executeDef = defineComponent<ChatExecute, ExecuteLayout>({
  kind: 'execute',

  estimate(_item, ctx: MeasureCtx): number {
    return ctx.theme.geometry.execRowH;
  },

  measure(_item, ctx: MeasureCtx): Measured<ExecuteLayout> {
    return {
      height: ctx.theme.geometry.execRowH,
      width: ctx.width,
      layout: { kind: 'execute' },
    };
  },

  Render: ExecuteRender,
});

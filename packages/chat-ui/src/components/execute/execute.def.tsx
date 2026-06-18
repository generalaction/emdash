/**
 * executeDef — ComponentDef for ChatExecute rows.
 *
 * Fixed height of EXEC_ROW_H (28px). No collapse state.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatExecute } from '../../model';
import { Execute } from './Execute';

/** Fixed row height for execute rows (px). */
const EXEC_ROW_H = 28;

export type ExecuteLayout = { kind: 'execute' };

function ExecuteRender(props: {
  item: ChatExecute;
  layout: Measured<ExecuteLayout>;
  ctx: RenderCtx;
}) {
  return (
    <div
      style={{
        height: `${props.layout.height}px`,
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

  estimate(): number {
    return EXEC_ROW_H;
  },

  measure(_item, ctx: MeasureCtx): Measured<ExecuteLayout> {
    return {
      height: EXEC_ROW_H,
      width: ctx.width,
      layout: { kind: 'execute' },
    };
  },

  Render: ExecuteRender,
});

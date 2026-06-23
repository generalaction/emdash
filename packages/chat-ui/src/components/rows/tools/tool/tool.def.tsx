import { ROW_H } from '@components/engine/row-metrics';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { ChatToolCall } from '@/model';
import { Tool } from './Tool';
import { toolRoot, toolVars } from './tool.css';

export const toolUnitDef = defineUnit<ChatToolCall, { rowH: number }>({
  kind: 'tool',
  margin: { top: 2, bottom: 2 },
  vars: { rowH: ROW_H },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div class={toolRoot} style={assignInlineVars(toolVars, pxTokens({ rowH: props.vars.rowH }))}>
        <Tool item={props.data} />
      </div>
    );
  },
});

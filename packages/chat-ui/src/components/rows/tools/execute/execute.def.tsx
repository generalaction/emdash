import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { ChatExecute } from '@/model';
import { Execute } from './Execute';
import { executeRoot, executeVars } from './execute.css';

export const executeUnitDef = defineUnit<ChatExecute, { rowH: number }>({
  kind: 'execute',
  vars: { rowH: 28 },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div
        class={executeRoot}
        style={assignInlineVars(executeVars, pxTokens({ rowH: props.vars.rowH }))}
      >
        <Execute item={props.data} />
      </div>
    );
  },
});

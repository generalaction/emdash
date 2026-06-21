import { assignInlineVars } from '@vanilla-extract/dynamic';
import { DEFAULT_THEME } from '../../../../core/theme';
import { defineUnit } from '../../../../core/units';
import type { ChatToolCall } from '../../../../model';
import { pxTokens } from '../../../../styles/px-tokens';
import { Tool } from './Tool';
import { toolRoot, toolVars } from './tool.css';

export const toolUnitDef = defineUnit<ChatToolCall, { rowH: number }>({
  kind: 'tool',
  vars: { rowH: DEFAULT_THEME.density.rowH },

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

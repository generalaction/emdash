import { DEFAULT_THEME } from '../../../../core/theme';
import { defineUnit } from '../../../../core/units';
import type { ChatToolCall } from '../../../../model';
import { sx } from '../../../../styles/sprinkles.css';
import { Tool } from './Tool';

export const toolUnitDef = defineUnit<ChatToolCall, { rowH: number }>({
  kind: 'tool',
  vars: { rowH: DEFAULT_THEME.density.rowH },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div
        class={sx({ display: 'flex', alignItems: 'center', borderColor: 'border' })}
        style={{ height: `${props.vars.rowH}px` }}
      >
        <Tool item={props.data} />
      </div>
    );
  },
});

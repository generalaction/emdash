import { defineUnit } from '../../../../core/units';
import type { ChatExecute } from '../../../../model';
import { Execute } from './Execute';

export const executeUnitDef = defineUnit<ChatExecute, { rowH: number }>({
  kind: 'execute',
  vars: { rowH: 28 },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div style={{ height: `${props.vars.rowH}px`, display: 'flex', 'align-items': 'center' }}>
        <Execute item={props.data} />
      </div>
    );
  },
});

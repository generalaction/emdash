/**
 * executeUnitDef — native UnitDef for ChatExecute rows.
 *
 * Fixed height of 28px. No collapse state.
 * Geometry constant `rowH` is declared in `vars` so that measure and Render
 * share a single source of truth. The old `execute/measure.ts` duplicate
 * (`EXEC_ROW_H` + `measureExecute`) has been folded here.
 */

import { defineUnit } from '../../core/units';
import type { ChatExecute } from '../../model';
import { Execute } from './Execute';

export const executeUnitDef = defineUnit<ChatExecute, { rowH: number }>({
  kind: 'execute',
  vars: { rowH: 28 },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    const rowH = () => props.vars?.rowH ?? 28;
    return (
      <div style={{ height: `${rowH()}px`, display: 'flex', 'align-items': 'center' }}>
        <Execute item={props.data} />
      </div>
    );
  },
});

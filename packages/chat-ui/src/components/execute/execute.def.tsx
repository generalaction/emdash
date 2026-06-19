/**
 * executeUnitDef — native UnitDef for ChatExecute rows.
 *
 * Fixed height of EXEC_ROW_H (28px). No collapse state.
 */

import { defineUnit } from '../../core/units';
import type { ChatExecute } from '../../model';
import { Execute } from './Execute';

/** Fixed row height for execute rows (px). */
export const EXEC_ROW_H = 28;

export const executeUnitDef = defineUnit<ChatExecute>({
  kind: 'execute',

  measure(): number {
    return EXEC_ROW_H;
  },

  Render(props) {
    return (
      <div style={{ height: `${EXEC_ROW_H}px`, display: 'flex', 'align-items': 'center' }}>
        <Execute item={props.data} />
      </div>
    );
  },
});

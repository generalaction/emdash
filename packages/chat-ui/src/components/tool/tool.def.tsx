/**
 * toolUnitDef — native UnitDef for ChatToolCall rows.
 *
 * Fixed height of ROW_H. No collapse state.
 * Geometry constant `rowH` is declared in `vars` so that measure and Render
 * share a single source of truth without importing the constant twice.
 */

import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatToolCall } from '../../model';
import { sx } from '../../styles/sprinkles.css';
import { Tool } from './Tool';

export const toolUnitDef = defineUnit<ChatToolCall, { rowH: number }>({
  kind: 'tool',
  vars: { rowH: ROW_H },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    const rowH = () => props.vars?.rowH ?? ROW_H;
    return (
      <div
        class={sx({ display: 'flex', alignItems: 'center', borderColor: 'border' })}
        style={{ height: `${rowH()}px` }}
      >
        <Tool item={props.data} />
      </div>
    );
  },
});

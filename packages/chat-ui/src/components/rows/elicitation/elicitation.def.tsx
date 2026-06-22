/**
 * elicitation.def.tsx — UnitDef for ChatElicitation rows.
 *
 * Single-unit, fixed height: the bordered box has a measured rowH so the
 * virtualizer never sees a mismatch. The split-button menu is portaled and
 * does not grow the row.
 */

import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { ChatElicitation } from '@/model';
import { PermissionRequest } from './PermissionRequest';
import { elicitationRoot, elicitationVars } from './elicitation.css';

export const elicitationUnitDef = defineUnit<ChatElicitation, { rowH: number }>({
  kind: 'elicitation',
  margin: { top: 2, bottom: 6 },
  vars: { rowH: 44 },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div
        class={elicitationRoot}
        style={assignInlineVars(elicitationVars, pxTokens({ rowH: props.vars.rowH }))}
      >
        <PermissionRequest item={props.data} />
      </div>
    );
  },
});

/**
 * resourceLinkUnitDef — native UnitDef for ChatResourceLink rows.
 *
 * Fixed single-line row height (ROW_H). No collapse state.
 * Geometry constant `rowH` is declared in `vars` so that measure and Render
 * share a single source of truth without importing the constant twice.
 */

import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatResourceLink } from '../../model';
import { ResourceLink } from './ResourceLink';

export const resourceLinkUnitDef = defineUnit<ChatResourceLink, { rowH: number }>({
  kind: 'resource-link',
  vars: { rowH: ROW_H },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    const rowH = () => props.vars?.rowH ?? ROW_H;
    return (
      <div style={{ height: `${rowH()}px`, display: 'flex', 'align-items': 'stretch' }}>
        <ResourceLink item={props.data} />
      </div>
    );
  },
});

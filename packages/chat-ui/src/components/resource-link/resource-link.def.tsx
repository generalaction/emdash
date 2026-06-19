/**
 * resourceLinkUnitDef — native UnitDef for ChatResourceLink rows.
 *
 * Fixed single-line row height (ROW_H). No collapse state.
 */

import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatResourceLink } from '../../model';
import { ResourceLink } from './ResourceLink';

export const resourceLinkUnitDef = defineUnit<ChatResourceLink>({
  kind: 'resource-link',

  measure(): number {
    return ROW_H;
  },

  Render(props) {
    return (
      <div style={{ height: `${ROW_H}px`, display: 'flex', 'align-items': 'stretch' }}>
        <ResourceLink item={props.data} />
      </div>
    );
  },
});

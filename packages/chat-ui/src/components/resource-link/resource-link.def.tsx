import { DEFAULT_THEME } from '../../core/theme';
import { defineUnit } from '../../core/units';
import type { ChatResourceLink } from '../../model';
import { ResourceLink } from './ResourceLink';

export const resourceLinkUnitDef = defineUnit<ChatResourceLink, { rowH: number }>({
  kind: 'resource-link',
  vars: { rowH: DEFAULT_THEME.density.rowH },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div style={{ height: `${props.vars.rowH}px`, display: 'flex', 'align-items': 'stretch' }}>
        <ResourceLink item={props.data} />
      </div>
    );
  },
});

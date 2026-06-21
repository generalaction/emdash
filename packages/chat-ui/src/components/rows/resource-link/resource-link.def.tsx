import { assignInlineVars } from '@vanilla-extract/dynamic';
import { DEFAULT_THEME } from '../../../core/theme';
import { defineUnit } from '../../../core/units';
import type { ChatResourceLink } from '../../../model';
import { pxTokens } from '../../../styles/px-tokens';
import { ResourceLink } from './ResourceLink';
import { resourceLinkRoot, resourceLinkVars } from './resource-link.css';

export const resourceLinkUnitDef = defineUnit<ChatResourceLink, { rowH: number }>({
  kind: 'resource-link',
  vars: { rowH: DEFAULT_THEME.density.rowH },

  measure(_data, _ctx, vars): number {
    return vars.rowH;
  },

  Render(props) {
    return (
      <div
        class={resourceLinkRoot}
        style={assignInlineVars(resourceLinkVars, pxTokens({ rowH: props.vars.rowH }))}
      >
        <ResourceLink item={props.data} />
      </div>
    );
  },
});

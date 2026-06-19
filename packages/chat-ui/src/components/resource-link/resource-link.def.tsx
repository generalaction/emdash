/**
 * resourceLinkDef — ComponentDef for ChatResourceLink rows.
 *
 * Fixed single-line row height (ROW_H). No collapse state; no estimate override
 * (genericEstimate is fine — every row is the same fixed height).
 */

import { defineComponent, type Measured, type RenderCtx } from '../../core/define';
import { ROW_H } from '../../core/metrics';
import type { ChatResourceLink } from '../../model';
import { ResourceLink } from './ResourceLink';

export type ResourceLinkLayout = { kind: 'resource-link' };

function ResourceLinkRender(props: {
  item: ChatResourceLink;
  layout: Measured<ResourceLinkLayout>;
  ctx: RenderCtx;
}) {
  return (
    <div style={{ height: `${props.layout.height}px`, display: 'flex', 'align-items': 'stretch' }}>
      <ResourceLink item={props.item} />
    </div>
  );
}

export const resourceLinkDef = defineComponent<ChatResourceLink, ResourceLinkLayout>({
  kind: 'resource-link',

  measure(_item, ctx): Measured<ResourceLinkLayout> {
    return { height: ROW_H, width: ctx.width, layout: { kind: 'resource-link' } };
  },

  Render: ResourceLinkRender,
});

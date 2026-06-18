/**
 * resourceLinkDef — ComponentDef for ChatResourceLink rows.
 *
 * Fixed 2-line card height: 2 × body line-height + vertical padding.
 * No collapse state; no estimate override (genericEstimate is fine —
 * every row is the same fixed height).
 */

import { defineComponent, type Measured, type RenderCtx } from '../../core/define';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import type { ChatResourceLink } from '../../model';
import { ResourceLink } from './ResourceLink';

export type ResourceLinkLayout = { kind: 'resource-link' };

/** Vertical padding inside the card on each side (px). */
const RESOURCE_LINK_PAD_Y = 6;

function resourceLinkHeight(lineH: number): number {
  // Two content lines: primary (title/name) + secondary (path/host/scheme).
  return 2 * lineH + RESOURCE_LINK_PAD_Y * 2 + HEADER_ROW_EXTRA_H;
}

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
    const height = resourceLinkHeight(ctx.theme.fonts.body.lineHeight);
    return { height, width: ctx.width, layout: { kind: 'resource-link' } };
  },

  Render: ResourceLinkRender,
});

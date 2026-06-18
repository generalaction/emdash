/**
 * proseDef — ComponentDef for ProseBlock / ProseLaidOut (block kind).
 *
 * Wraps the existing layoutProse() / measureProseNaturalWidth() functions.
 * The block-kind `measure()` always passes `blockTop: 0`; the parent composite
 * (messageDef via layoutBlocks) supplies the actual absolute `top` offset in
 * the composed stack.
 *
 * Used by the REGISTRY for block-level dispatch inside message and thinking.
 */

import { defineComponent, type Measured, type RenderCtx } from '../../core/define';
import type { ProseLaidOut } from '../../core/layout/layout-types';
import type { ProseBlock } from '../../core/markdown/document';
import { layoutProse } from './layout';
import { Prose } from './Prose';

export type ProseDefLayout = ProseLaidOut;

function ProseRender(props: {
  item: ProseBlock;
  layout: Measured<ProseDefLayout>;
  ctx: RenderCtx;
}) {
  return <Prose block={props.layout.layout} runs={props.item.runs} variant={props.item.variant} />;
}

export const proseDef = defineComponent<ProseBlock, ProseDefLayout>({
  kind: 'prose',

  measure(item, ctx): Measured<ProseDefLayout> {
    const laid = layoutProse(item, ctx.width, ctx.theme.fonts, 0);
    return {
      height: laid.height,
      width: laid.contentWidth,
      layout: laid,
    };
  },

  Render: ProseRender,
});

/**
 * proseDef — ComponentDef for ProseBlock / ProseLaidOut (block tier).
 *
 * Wraps the existing layoutProse() / measureProseNaturalWidth() functions.
 * The block-tier `measure()` always passes `blockTop: 0`; the parent composite
 * (messageDef via layoutBlocks) supplies the actual absolute `top` offset in
 * the composed BlocksLayout.
 *
 * Used by the REGISTRY for block-level dispatch inside message and thinking.
 */

import type { ProseBlock } from '../../core/blocks/block-types';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ProseLaidOut } from '../../core/layout/layout-types';
import { layoutProse } from './layout';
import { Prose } from './Prose';

export type ProseDefLayout = ProseLaidOut & { kind: 'prose' };

function ProseRender(props: {
  item: ProseBlock;
  layout: Measured<ProseDefLayout>;
  ctx: RenderCtx;
}) {
  return <Prose block={props.layout.layout} runs={props.item.runs} variant={props.item.variant} />;
}

export const proseDef = defineComponent<ProseBlock, ProseDefLayout>({
  kind: 'prose',

  estimate(item, ctx: MeasureCtx): number {
    const lines = Math.max(
      1,
      Math.ceil(item.runs.map((r) => ('text' in r ? (r.text ?? '') : '')).join('').length / 60)
    );
    return lines * ctx.theme.fonts.body.lineHeight;
  },

  measure(item, ctx: MeasureCtx): Measured<ProseDefLayout> {
    const laid = layoutProse(item, ctx.width, ctx.theme.fonts, 0);
    return {
      height: laid.height,
      width: laid.contentWidth,
      layout: { ...laid, kind: 'prose' },
    };
  },

  Render: ProseRender,
});

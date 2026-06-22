import { defineBlock } from '@components/rows/markdown/block-def';
import type { Measured, MeasureCtx } from '@core/define';
import type { ProseLeafLayout } from '@core/layout/layout-types';
import type { ProseBlock } from '@core/markdown/document';
import { layoutProse } from './layout';
import { Prose } from './Prose';

export const proseBlockDef = defineBlock<ProseBlock, ProseLeafLayout>({
  kind: 'prose',

  measure(block: ProseBlock, ctx: MeasureCtx): Measured<ProseLeafLayout> {
    const laid = layoutProse(
      block,
      ctx.width,
      ctx.theme.fonts,
      ctx.theme.prose,
      0,
      ctx.caches.prepareRichInline.bind(ctx.caches)
    );
    const layout: ProseLeafLayout = { ...laid, raw: block };
    return { height: laid.height, width: laid.contentWidth, layout };
  },

  Render(props: { node: Measured<ProseLeafLayout> }) {
    const l = props.node.layout;
    return <Prose block={l} runs={l.raw.runs} variant={l.raw.variant} />;
  },
});

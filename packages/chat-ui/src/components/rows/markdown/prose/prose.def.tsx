import { defineBlock } from '@components/rows/markdown/block-def';
import type { Measured, MeasureCtx } from '@core/define';
import type { ProseLeafLayout } from '@core/layout/layout-types';
import type { ProseBlock } from '@core/markdown/document';
import { layoutProse } from './layout';
import { Prose } from './Prose';

export const proseBlockDef = defineBlock<ProseBlock, ProseLeafLayout>({
  kind: 'prose',
  margin(block) {
    switch (block.variant) {
      case 'h1':
        return { top: 16, bottom: 6 };
      case 'h2':
        return { top: 13, bottom: 5 };
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return { top: 10, bottom: 4 };
      case 'list-item':
        return { top: 2, bottom: 2 };
      case 'quote':
        return { top: 6, bottom: 6 };
      default:
        return { top: 6, bottom: 6 };
    }
  },

  measure(block: ProseBlock, ctx: MeasureCtx): Measured<ProseLeafLayout> {
    const laid = layoutProse(
      block,
      ctx.width,
      ctx.theme.fonts,
      0,
      ctx.caches.prepareRichInline.bind(ctx.caches)
    );
    const layout: ProseLeafLayout = { ...laid, raw: block };
    return { height: laid.height, width: laid.contentWidth, layout };
  },

  Render(props: { node: Measured<ProseLeafLayout> }) {
    // Reactive reads (no setup-time snapshot): BlockStackView keys rows by
    // block id, so this component instance survives streaming re-layouts of
    // the same block and must track props.node.
    return (
      <Prose
        block={props.node.layout}
        runs={props.node.layout.raw.runs}
        variant={props.node.layout.raw.variant}
      />
    );
  },
});

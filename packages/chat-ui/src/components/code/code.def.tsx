/**
 * codeDef — ComponentDef for CodeBlock / CodeLaidOut (block tier).
 *
 * Height = lines.length * code.lineHeight + 2 * CODE_PAD_Y + 2 * CODE_BORDER
 * `measure()` always passes `blockTop: 0`; the parent stack combinator
 * (layoutBlocks in messageDef) supplies the actual vertical offset.
 */

import type { CodeBlock } from '../../core/blocks/block-types';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { reserveHeight } from '../../core/layout/reserve-height';
import { Code } from './Code';

/** Vertical padding on each side of the code block (px). */
const CODE_PAD_Y = 8;
/** Border width (px) on each side of the code block. */
const CODE_BORDER = 1;

export type CodeDefLayout = CodeLaidOut & { kind: 'code' };

function CodeRender(props: { item: CodeBlock; layout: Measured<CodeDefLayout>; ctx: RenderCtx }) {
  return <Code block={props.layout.layout} rawBlock={props.item} />;
}

export const codeDef = defineComponent<CodeBlock, CodeDefLayout>({
  kind: 'code',

  estimate(item, ctx: MeasureCtx): number {
    const lineCount = Math.max(1, item.code.split('\n').length);
    return reserveHeight({
      content: lineCount * ctx.theme.fonts.code.lineHeight,
      padY: CODE_PAD_Y,
      border: CODE_BORDER,
    });
  },

  measure(item, ctx: MeasureCtx): Measured<CodeDefLayout> {
    const codeLineHeight = ctx.theme.fonts.code.lineHeight;
    const rawLines = item.code.split('\n');

    const lines = rawLines.map((text, i) => ({
      top: CODE_PAD_Y + i * codeLineHeight,
      text,
    }));

    const height = reserveHeight({
      content: rawLines.length * codeLineHeight,
      padY: CODE_PAD_Y,
      border: CODE_BORDER,
    });

    const laid: CodeLaidOut = {
      kind: 'code',
      id: item.id,
      top: 0,
      height,
      contentWidth: ctx.width,
      lines,
      lang: item.lang,
    };

    return {
      height,
      width: ctx.width,
      layout: { ...laid, kind: 'code' },
    };
  },

  Render: CodeRender,
});

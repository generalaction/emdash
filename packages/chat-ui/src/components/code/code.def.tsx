/**
 * codeDef — ComponentDef for CodeBlock / CodeLaidOut (block tier).
 *
 * Wraps layoutCode() with theme-threaded geometry constants.
 * `measure()` always passes `blockTop: 0`; the parent stack combinator
 * (layoutBlocks in messageDef) supplies the actual vertical offset.
 */

import type { CodeBlock } from '../../core/blocks/block-types';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { reserveHeight } from '../../core/layout/reserve-height';
import { Code } from './Code';

export type CodeDefLayout = CodeLaidOut & { kind: 'code' };

function CodeRender(props: { item: CodeBlock; layout: Measured<CodeDefLayout>; ctx: RenderCtx }) {
  return <Code block={props.layout.layout} rawBlock={props.item} />;
}

export const codeDef = defineComponent<CodeBlock, CodeDefLayout>({
  kind: 'code',

  estimate(item, ctx: MeasureCtx): number {
    const { codePadY, codeBorder } = ctx.theme.geometry;
    const lineCount = Math.max(1, item.code.split('\n').length);
    return reserveHeight({
      content: lineCount * ctx.theme.fonts.code.lineHeight,
      padY: codePadY,
      border: codeBorder,
    });
  },

  measure(item, ctx: MeasureCtx): Measured<CodeDefLayout> {
    const { codePadY, codeBorder } = ctx.theme.geometry;
    const codeLineHeight = ctx.theme.fonts.code.lineHeight;
    const rawLines = item.code.split('\n');

    const lines = rawLines.map((text, i) => ({
      top: codePadY + i * codeLineHeight,
      text,
    }));

    const height = reserveHeight({
      content: rawLines.length * codeLineHeight,
      padY: codePadY,
      border: codeBorder,
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

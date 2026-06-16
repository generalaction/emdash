/**
 * layoutCode — compute geometry for a CodeBlock.
 */
import type { CodeBlock } from '../blocks/block-types';
import type { FontConfig } from '../measure/fonts';
import type { CodeLaidOut } from './layout-types';

export function layoutCode(
  block: CodeBlock,
  fonts: FontConfig,
  blockTop: number,
  effectiveWidth: number
): CodeLaidOut {
  const { codeBlockPadY } = fonts;
  const codeLineHeight = fonts.code.lineHeight;

  const rawLines = block.code.split('\n');
  const chrome = 2 * codeBlockPadY + 2 * fonts.codeBlockBorder;

  const positionedLines = rawLines.map((text, i) => ({
    top: codeBlockPadY + i * codeLineHeight,
    text,
  }));

  const height = rawLines.length * codeLineHeight + chrome;

  return {
    kind: 'code',
    id: block.id,
    top: blockTop,
    height,
    contentWidth: effectiveWidth,
    lines: positionedLines,
    lang: block.lang,
  };
}

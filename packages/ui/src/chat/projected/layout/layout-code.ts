/**
 * layoutCode — compute geometry for a CodeBlock.
 *
 * No pretext — code blocks are never wrapped; lines are fixed-height rows at
 * (padY + i * codeLineHeight). Width overflows horizontally via scroll.
 */

import type { CodeBlock } from '../../blocks/block-types';
import type { FontConfig } from '../../measure/fonts';
import { CODE_BLOCK_BORDER, CODE_LANG } from '../../metrics';
import type { CodeLaidOut } from './layout-types';

const LANG_LABEL_MARGIN = 6; // px margin below lang label — matches chat.css

export function layoutCode(
  block: CodeBlock,
  fonts: FontConfig,
  blockTop: number,
  effectiveWidth: number
): CodeLaidOut {
  const { codeBlockPadY } = fonts;
  const codeLineHeight = fonts.code.lineHeight;

  const langHeight = block.lang ? CODE_LANG.lineHeight + LANG_LABEL_MARGIN : 0;
  const rawLines = block.code.split('\n');
  const chrome = 2 * codeBlockPadY + 2 * CODE_BLOCK_BORDER;

  const positionedLines = rawLines.map((text, i) => ({
    top: codeBlockPadY + langHeight + i * codeLineHeight,
    text,
  }));

  const height = langHeight + rawLines.length * codeLineHeight + chrome;

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

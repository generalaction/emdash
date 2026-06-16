/**
 * layoutCode — pure geometry for a CodeBlock.
 *
 * Moved here from core/layout/layout-code.ts so that layout constants,
 * CSS vars, and the renderer live in the same folder.
 *
 * Constants come from ./metrics (single source of truth).
 * Typography (line height) comes from the FontConfig passed in.
 */

import type { CodeBlock } from '../../core/blocks/block-types';
import type { FontConfig } from '../../core/measure/fonts';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { CODE_BLOCK_PAD_Y, CODE_BLOCK_BORDER } from './metrics';

export function layoutCode(
  block: CodeBlock,
  fonts: FontConfig,
  blockTop: number,
  effectiveWidth: number
): CodeLaidOut {
  const codeLineHeight = fonts.code.lineHeight;
  const chrome = 2 * CODE_BLOCK_PAD_Y + 2 * CODE_BLOCK_BORDER;
  const rawLines = block.code.split('\n');

  const lines = rawLines.map((text, i) => ({
    top: CODE_BLOCK_PAD_Y + i * codeLineHeight,
    text,
  }));

  const height = rawLines.length * codeLineHeight + chrome;

  return {
    kind: 'code',
    id: block.id,
    top: blockTop,
    height,
    contentWidth: effectiveWidth,
    lines,
    lang: block.lang,
  };
}

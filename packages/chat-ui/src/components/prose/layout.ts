/**
 * layoutProse / measureProseNaturalWidth — pure geometry for a ProseBlock.
 *
 * Moved here from core/layout/layout-prose.ts so that layout logic lives
 * alongside the Prose renderer.  No DOM access; uses pretext for text shaping.
 */

import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  walkRichInlineLineRanges,
} from '@chenglou/pretext/rich-inline';
import type { ProseBlock } from '../../core/blocks/block-types';
import type {
  BulletLayout,
  FragmentLayout,
  LineLayout,
  ProseLaidOut,
} from '../../core/layout/layout-types';
import { runsToRichItems } from '../../core/layout/runs-to-rich-items';
import type { FontConfig } from '../../core/measure/fonts';
import { getPreparedRichInline } from '../../core/measure/pretext-cache';
import { BLOCKQUOTE_INDENT, LIST_INDENT } from '../../core/metrics';

const UNBOUNDED_WIDTH = 1e7;

function lineHeightForVariant(variant: ProseBlock['variant'], fonts: FontConfig): number {
  switch (variant) {
    case 'h1':
      return fonts.h1.lineHeight;
    case 'h2':
      return fonts.h2.lineHeight;
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return fonts.h3.lineHeight;
    default:
      return fonts.body.lineHeight;
  }
}

function proseIndent(block: ProseBlock): { indent: number; textLeft: number } {
  const depth = block.depth ?? 0;
  const isListItem = block.variant === 'list-item';
  const isQuote = block.variant === 'quote';
  const indentPerLevel = isListItem ? LIST_INDENT : isQuote ? BLOCKQUOTE_INDENT : 0;
  const indent = (depth + 1) * indentPerLevel;
  const textLeft = isListItem ? indent + LIST_INDENT * 0.4 : indent;
  return { indent, textLeft };
}

export function measureProseNaturalWidth(block: ProseBlock, fonts: FontConfig): number {
  if (block.runs.length === 0) return 0;
  const { textLeft } = proseIndent(block);
  const items = runsToRichItems(block.runs, fonts);
  const prepared = getPreparedRichInline(items);
  const stats = measureRichInlineStats(prepared, UNBOUNDED_WIDTH);
  return textLeft + stats.maxLineWidth;
}

export function layoutProse(
  block: ProseBlock,
  width: number,
  fonts: FontConfig,
  blockTop: number
): ProseLaidOut {
  const lineHeight = lineHeightForVariant(block.variant, fonts);

  if (block.runs.length === 0) {
    return {
      kind: 'prose',
      id: block.id,
      top: blockTop,
      height: 0,
      contentWidth: 0,
      lineHeight,
      lines: [],
    };
  }

  const isQuote = block.variant === 'quote';
  const isListItem = block.variant === 'list-item';
  const { indent, textLeft } = proseIndent(block);
  const effectiveWidth = Math.max(1, width - textLeft);

  const items = runsToRichItems(block.runs, fonts);
  const prepared = getPreparedRichInline(items);

  const lines: LineLayout[] = [];
  let lineIndex = 0;
  let maxRight = 0;

  walkRichInlineLineRanges(prepared, effectiveWidth, (range) => {
    const line = materializeRichInlineLineRange(prepared, range);
    let x = 0;
    const frags: FragmentLayout[] = [];

    for (const f of line.fragments) {
      x += f.gapBefore;
      frags.push({ text: f.text, x, runIndex: f.itemIndex });
      x += f.occupiedWidth;
    }

    maxRight = Math.max(maxRight, textLeft + x);
    lines.push({ top: lineIndex * lineHeight, left: textLeft, fragments: frags, endX: x });
    lineIndex++;
  });

  const height = lineIndex * lineHeight;

  let bullet: BulletLayout | undefined;
  if (isListItem) {
    bullet = {
      x: indent,
      top: Math.floor(lineHeight / 2) - 6,
      char: '•',
    };
  }

  return {
    kind: 'prose',
    id: block.id,
    top: blockTop,
    height,
    contentWidth: maxRight,
    lineHeight,
    lines,
    bullet,
    quoteRail: isQuote,
  };
}

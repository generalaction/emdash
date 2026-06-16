/**
 * layoutProse — compute exact line/fragment geometry for a ProseBlock.
 *
 * Uses pretext's `walkRichInlineLineRanges` + `materializeRichInlineLineRange`
 * to get pixel-accurate x-offsets for every fragment on every line, without
 * asking the browser to do any text layout.
 */

import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  walkRichInlineLineRanges,
} from '@chenglou/pretext/rich-inline';
import type { ProseBlock } from '../../blocks/block-types';
import type { FontConfig } from '../../measure/fonts';
import { getPreparedRichInline } from '../../measure/pretext-cache';
import { BLOCKQUOTE_INDENT, LIST_INDENT } from '../../metrics';
import type { BulletLayout, FragmentLayout, LineLayout, ProseLaidOut } from './layout-types';
import { runsToRichItems } from './runs-to-rich-items';

/** Effectively-unbounded width for single-line (natural) measurement. */
const UNBOUNDED_WIDTH = 1e7;

// ── Variant helpers ──────────────────────────────────────────────────────────

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

/** Left indent (and bullet gutter) for a prose block's variant + depth. */
function proseIndent(block: ProseBlock): { indent: number; textLeft: number } {
  const depth = block.depth ?? 0;
  const isListItem = block.variant === 'list-item';
  const isQuote = block.variant === 'quote';
  const indentPerLevel = isListItem ? LIST_INDENT : isQuote ? BLOCKQUOTE_INDENT : 0;
  const indent = (depth + 1) * indentPerLevel;
  const textLeft = isListItem ? indent + LIST_INDENT * 0.4 : indent; // bullet gutter for lists
  return { indent, textLeft };
}

/**
 * Natural (unwrapped) width of a prose block in px, including its left indent.
 *
 * Measures the single-line width via pretext (no wrapping). Used to size a
 * shrink-wrapped user bubble: the bubble hugs the text exactly when it fits,
 * and is clamped to the max width only when the text must wrap.
 */
export function measureProseNaturalWidth(block: ProseBlock, fonts: FontConfig): number {
  if (block.runs.length === 0) return 0;
  const { textLeft } = proseIndent(block);
  const items = runsToRichItems(block.runs, fonts);
  const prepared = getPreparedRichInline(items);
  const stats = measureRichInlineStats(prepared, UNBOUNDED_WIDTH);
  return textLeft + stats.maxLineWidth;
}

// ── Main layout function ─────────────────────────────────────────────────────

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

  // Compute left indent and available text width
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

    // Track the rightmost occupied pixel: indent + running x after all fragments.
    maxRight = Math.max(maxRight, textLeft + x);

    lines.push({ top: lineIndex * lineHeight, left: textLeft, fragments: frags });
    lineIndex++;
  });

  const height = lineIndex * lineHeight;

  // Bullet decoration for list items
  let bullet: BulletLayout | undefined;
  if (isListItem) {
    bullet = {
      // Position bullet at the indent level, centred on the first line
      x: indent,
      top: Math.floor(lineHeight / 2) - 6, // approximate vertical centre
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

/**
 * layoutMessage — stack block layouts into a full MessageLayout.
 *
 * Moved here from core/layout/layout-message.ts so that the message orchestrator
 * lives alongside its sibling block layouts (components/ -> components/).
 *
 * Delegates the block-stacking loop to layoutBlocks (rich-text/layout.ts) and
 * adds the message-specific concerns: user-bubble effective-width calculation
 * and empty-blocks fallback. The row wrapper padding (ROW_PAD_Y) is applied
 * by Row.tsx and is NOT baked into the height returned here.
 *
 * The `isCollapsed` injected function keeps this module framework-agnostic
 * (no Solid imports, no ViewState import).
 */

import type { Block } from '../../core/blocks/block-types';
import type { MessageLayout } from '../../core/layout/layout-types';
import type { FontConfig } from '../../core/measure/fonts';
import { USER_BUBBLE_MAX_WIDTH_PCT } from '../../core/metrics';
import type { ChatRole } from '../../model';
import { measureProseNaturalWidth } from '../prose/layout';
import { layoutBlocks } from '../rich-text/layout';

// ── Message layout constants ──────────────────────────────────────────────────

/** Horizontal padding inside the message bubble on each side (px). */
export const BUBBLE_PAD_X = 14;
/** Vertical padding inside the message bubble on each side (px). */
export const BUBBLE_PAD_Y = 8;
/** Gap between blocks of different tiers (code, table) in the block stack (px). */
export const BLOCK_GAP = 10;
/** Tighter gap between two consecutive prose blocks (px). */
export const PROSE_GAP = 4;
/** Reserved height for the assistant message footer (copy button row, px). */
export const MESSAGE_FOOTER_H = 24;

export function layoutMessage(
  blocks: Block[],
  rowWidth: number,
  fonts: FontConfig,
  isCollapsed: (id: string) => boolean,
  role: ChatRole = 'assistant'
): MessageLayout {
  // Reserve footer space for assistant messages (copy button).
  const footer = role === 'assistant' ? MESSAGE_FOOTER_H : 0;

  if (blocks.length === 0) {
    return {
      height: fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + footer,
      width: 0,
      blocks: [],
    };
  }

  const contentWidth = rowWidth;
  const effectiveWidth =
    role === 'user' ? userEffectiveWidth(blocks, contentWidth, fonts, isCollapsed) : contentWidth;

  const inner = layoutBlocks(blocks, effectiveWidth, fonts, {
    padY: BUBBLE_PAD_Y,
    blockGap: BLOCK_GAP,
    proseGap: PROSE_GAP,
    isCollapsed,
  });

  return { ...inner, height: inner.height + footer };
}

function userEffectiveWidth(
  blocks: Block[],
  contentWidth: number,
  fonts: FontConfig,
  isCollapsed: (id: string) => boolean
): number {
  const maxAllowed =
    Math.floor((contentWidth * USER_BUBBLE_MAX_WIDTH_PCT) / 100) - 2 * BUBBLE_PAD_X;

  let maxNatural = 0;
  for (const block of blocks) {
    if (isCollapsed(block.id)) continue;
    if (block.tier === 'prose') {
      maxNatural = Math.max(maxNatural, measureProseNaturalWidth(block, fonts));
    } else {
      return Math.max(1, maxAllowed);
    }
  }

  return Math.max(1, Math.min(Math.ceil(maxNatural) + 1, maxAllowed));
}

/**
 * layoutMessage — stack block layouts into a full MessageLayout.
 *
 * Moved here from core/layout/layout-message.ts so that the message orchestrator
 * lives alongside its sibling block layouts (components/ -> components/).
 *
 * Delegates the block-stacking loop to layoutBlocks (rich-text/layout.ts) and
 * adds the message-specific concerns: user-bubble effective-width calculation,
 * empty-blocks fallback, and ROW_GAP for the virtualizer.
 *
 * ROW_GAP is added to the total height so the virtualizer height includes the
 * inter-row gap.  The message bubble height is `height - ROW_GAP`.
 *
 * The `isCollapsed` / `getMeasured` injected functions keep this module
 * framework-agnostic (no Solid imports, no ViewState import).
 */

import type { Block } from '../../core/blocks/block-types';
import type { MessageLayout } from '../../core/layout/layout-types';
import type { FontConfig } from '../../core/measure/fonts';
import { ROW_GAP, ROW_INSET_X, USER_BUBBLE_MAX_WIDTH_PCT } from '../../core/metrics';
import type { ChatRole } from '../../model';
import { measureProseNaturalWidth } from '../prose/layout';
import { layoutBlocks } from '../rich-text/layout';
import { BUBBLE_PAD_X, BUBBLE_PAD_Y, BLOCK_GAP, PROSE_GAP } from './metrics';

export function layoutMessage(
  blocks: Block[],
  rowWidth: number,
  fonts: FontConfig,
  isCollapsed: (id: string) => boolean,
  getMeasured: (id: string) => number | undefined,
  role: ChatRole = 'assistant'
): MessageLayout {
  if (blocks.length === 0) {
    return {
      height: fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + ROW_GAP,
      width: 0,
      blocks: [],
    };
  }

  const contentWidth = rowWidth - 2 * ROW_INSET_X;
  const effectiveWidth =
    role === 'user' ? userEffectiveWidth(blocks, contentWidth, fonts, isCollapsed) : contentWidth;

  const inner = layoutBlocks(blocks, effectiveWidth, fonts, {
    padY: BUBBLE_PAD_Y,
    blockGap: BLOCK_GAP,
    proseGap: PROSE_GAP,
    isCollapsed,
    getMeasured,
  });

  return { ...inner, height: inner.height + ROW_GAP };
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

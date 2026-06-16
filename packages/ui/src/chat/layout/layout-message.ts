/**
 * layoutMessage — stack block layouts into a full MessageLayout.
 *
 * Assigns each block a `top` offset by accumulating:
 *   BUBBLE_PAD_Y  +  block heights  +  BLOCK_GAP between visible blocks
 * and sets the total `height` = sum + 2*BUBBLE_PAD_Y + MESSAGE_GAP.
 *
 * This is the single source of truth for BOTH height (virtualizer) and
 * geometry (render). Collapsed blocks contribute height 0 and are skipped
 * in the gap calculation.
 *
 * The `role` argument drives the `effectiveWidth` used for prose wrapping:
 *   - assistant/thought: full row width minus MESSAGE_PAD_X on each side
 *   - user: shrink-wrapped — the bubble hugs the text. We measure the natural
 *     (unwrapped) width of the content via pretext and lay out at
 *     `min(naturalWidth, maxAllowed)`, where `maxAllowed` is
 *     USER_BUBBLE_MAX_WIDTH_PCT of the row minus bubble padding. Short text
 *     hugs exactly; long text wraps only at the cap. (No CSS fit-content —
 *     children are absolutely positioned, so width comes from measurement.)
 *
 * The returned `width` is the max content width across all blocks.
 * Callers use it to size the user bubble so it hugs the widest line.
 */

import type { Block } from '../blocks/block-types';
import type { FontConfig } from '../measure/fonts';
import {
  BLOCK_GAP,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  MESSAGE_GAP,
  MESSAGE_PAD_X,
  USER_BUBBLE_MAX_WIDTH_PCT,
} from '../metrics';
import type { ChatRole } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import { layoutCode } from './layout-code';
import { layoutIsland } from './layout-island';
import { layoutProse, measureProseNaturalWidth } from './layout-prose';
import type { BlockLaidOut, MessageLayout } from './layout-types';

export function layoutMessage(
  blocks: Block[],
  width: number,
  fonts: FontConfig,
  viewState: ViewStateStore,
  /** DOM-measured heights for islands, from LayoutStore.measured. */
  measuredMap: ReadonlyMap<string, number>,
  role: ChatRole = 'assistant'
): MessageLayout {
  if (blocks.length === 0) {
    return {
      height: fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + MESSAGE_GAP,
      width: 0,
      blocks: [],
    };
  }

  // Width available for block content (prose wrapping, code, islands).
  const rowWidth = width - 2 * MESSAGE_PAD_X;
  const effectiveWidth =
    role === 'user' ? userEffectiveWidth(blocks, rowWidth, fonts, viewState) : rowWidth;

  let cursor = BUBBLE_PAD_Y; // tracks current top inside the bubble content area
  let visibleCount = 0;
  let maxContentWidth = 0;
  const laid: BlockLaidOut[] = [];

  for (const block of blocks) {
    const collapsed = viewState.isCollapsed(block.id);

    let laidBlock: BlockLaidOut;

    if (collapsed) {
      // Collapsed block: zero height, zero content width
      if (block.tier === 'prose') {
        laidBlock = {
          kind: 'prose',
          id: block.id,
          top: cursor,
          height: 0,
          contentWidth: 0,
          lineHeight: 0,
          lines: [],
        };
      } else if (block.tier === 'code') {
        laidBlock = {
          kind: 'code',
          id: block.id,
          top: cursor,
          height: 0,
          contentWidth: 0,
          lines: [],
        };
      } else {
        laidBlock = {
          kind: 'island',
          id: block.id,
          top: cursor,
          height: 0,
          contentWidth: 0,
          islandType: block.islandType,
          raw: block.raw,
        };
      }
      laid.push(laidBlock);
      continue;
    }

    // Gap before visible block (not before the first)
    if (visibleCount > 0) {
      cursor += BLOCK_GAP;
    }

    switch (block.tier) {
      case 'prose':
        laidBlock = layoutProse(block, effectiveWidth, fonts, cursor);
        break;
      case 'code':
        laidBlock = layoutCode(block, fonts, cursor, effectiveWidth);
        break;
      case 'island':
        laidBlock = layoutIsland(block, fonts, cursor, effectiveWidth, measuredMap.get(block.id));
        break;
    }

    maxContentWidth = Math.max(maxContentWidth, laidBlock.contentWidth);
    cursor += laidBlock.height;
    visibleCount++;
    laid.push(laidBlock);
  }

  cursor += BUBBLE_PAD_Y; // bottom padding
  const height = cursor + MESSAGE_GAP;

  return { height, width: maxContentWidth, blocks: laid };
}

/**
 * Shrink-wrap width for a user bubble's content.
 *
 * `maxAllowed` is USER_BUBBLE_MAX_WIDTH_PCT of the row, minus bubble padding.
 * We measure the natural single-line width of each visible prose block and
 * return `min(maxNatural, maxAllowed)`. Code/island blocks are full-width, so
 * if any visible one exists the result is `maxAllowed`.
 *
 * Laying out prose at this width keeps single-line messages hugging exactly
 * while wrapping only happens once the text exceeds the cap.
 */
function userEffectiveWidth(
  blocks: Block[],
  rowWidth: number,
  fonts: FontConfig,
  viewState: ViewStateStore
): number {
  const maxAllowed = Math.floor((rowWidth * USER_BUBBLE_MAX_WIDTH_PCT) / 100) - 2 * BUBBLE_PAD_X;

  let maxNatural = 0;
  for (const block of blocks) {
    if (viewState.isCollapsed(block.id)) continue;
    if (block.tier === 'prose') {
      maxNatural = Math.max(maxNatural, measureProseNaturalWidth(block, fonts));
    } else {
      // Code/island are treated as full-width; force the bubble to the cap.
      return Math.max(1, maxAllowed);
    }
  }

  // +1px guard against floating-point rounding re-wrapping an exact-fit line.
  return Math.max(1, Math.min(Math.ceil(maxNatural) + 1, maxAllowed));
}

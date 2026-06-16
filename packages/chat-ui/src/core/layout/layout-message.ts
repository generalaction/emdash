/**
 * layoutMessage — stack block layouts into a full MessageLayout.
 *
 * Key change from @emdash/ui: the viewState dependency is replaced by a plain
 * `isCollapsed(id): boolean` function so the core layout stays framework-agnostic.
 * Similarly, measured heights come in as a plain `getMeasured(id): number | undefined`.
 *
 * ROW_GAP is added to the total height by this function so the virtualizer height
 * includes the inter-row gap.  The message bubble height is height - ROW_GAP.
 *
 * For user bubbles, prose is laid out at min(naturalWidth, maxAllowed), giving
 * true shrink-wrapping without CSS fit-content (children are absolutely positioned).
 */

import type { ChatRole } from '../../model';
import type { Block } from '../blocks/block-types';
import type { FontConfig } from '../measure/fonts';
import { ROW_GAP, ROW_INSET_X, USER_BUBBLE_MAX_WIDTH_PCT } from '../metrics';
import { layoutCode } from './layout-code';
import { layoutIsland } from './layout-island';
import { layoutProse, measureProseNaturalWidth } from './layout-prose';
import type { BlockLaidOut, MessageLayout } from './layout-types';

export function layoutMessage(
  blocks: Block[],
  rowWidth: number,
  fonts: FontConfig,
  isCollapsed: (id: string) => boolean,
  getMeasured: (id: string) => number | undefined,
  role: ChatRole = 'assistant'
): MessageLayout {
  const { bubblePadY, blockGap } = fonts;

  if (blocks.length === 0) {
    return {
      height: fonts.body.lineHeight + 2 * bubblePadY + ROW_GAP,
      width: 0,
      blocks: [],
    };
  }

  const contentWidth = rowWidth - 2 * ROW_INSET_X;
  const effectiveWidth =
    role === 'user' ? userEffectiveWidth(blocks, contentWidth, fonts, isCollapsed) : contentWidth;

  let cursor = bubblePadY;
  let visibleCount = 0;
  let maxContentWidth = 0;
  const laid: BlockLaidOut[] = [];

  for (const block of blocks) {
    const collapsed = isCollapsed(block.id);

    let laidBlock: BlockLaidOut;

    if (collapsed) {
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

    if (visibleCount > 0) cursor += blockGap;

    switch (block.tier) {
      case 'prose':
        laidBlock = layoutProse(block, effectiveWidth, fonts, cursor);
        break;
      case 'code':
        laidBlock = layoutCode(block, fonts, cursor, effectiveWidth);
        break;
      case 'island':
        laidBlock = layoutIsland(block, fonts, cursor, effectiveWidth, getMeasured(block.id));
        break;
    }

    maxContentWidth = Math.max(maxContentWidth, laidBlock.contentWidth);
    cursor += laidBlock.height;
    visibleCount++;
    laid.push(laidBlock);
  }

  cursor += bubblePadY;
  const height = cursor + ROW_GAP;

  return { height, width: maxContentWidth, blocks: laid };
}

function userEffectiveWidth(
  blocks: Block[],
  contentWidth: number,
  fonts: FontConfig,
  isCollapsed: (id: string) => boolean
): number {
  const { bubblePadX } = fonts;
  const maxAllowed =
    Math.floor((contentWidth * USER_BUBBLE_MAX_WIDTH_PCT) / 100) - 2 * (bubblePadX ?? 14);

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

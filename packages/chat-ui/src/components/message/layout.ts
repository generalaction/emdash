/**
 * layoutMessage — stack block layouts into a full MessageLayout.
 *
 * Moved here from core/layout/layout-message.ts so that the message orchestrator
 * lives alongside its sibling block layouts (components/ -> components/).
 *
 * Imports block layout functions directly from their component folders.
 * Dependency direction: components/ -> core/ (not the reverse).
 *
 * ROW_GAP is added to the total height so the virtualizer height includes the
 * inter-row gap.  The message bubble height is `height - ROW_GAP`.
 *
 * The `isCollapsed` / `getMeasured` injected functions keep this module
 * framework-agnostic (no Solid imports, no ViewState import).
 */

import type { Block } from '../../core/blocks/block-types';
import type { BlockLaidOut, MessageLayout } from '../../core/layout/layout-types';
import type { FontConfig } from '../../core/measure/fonts';
import { ROW_GAP, ROW_INSET_X, USER_BUBBLE_MAX_WIDTH_PCT } from '../../core/metrics';
import type { ChatRole } from '../../model';
import { layoutCode } from '../code/layout';
import { layoutIsland } from '../island/layout';
import { layoutProse, measureProseNaturalWidth } from '../prose/layout';
import { layoutTable } from '../table/layout';
import { BUBBLE_PAD_X, BUBBLE_PAD_Y, BLOCK_GAP } from './metrics';

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

  let cursor = BUBBLE_PAD_Y;
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
      } else if (block.tier === 'table') {
        laidBlock = {
          kind: 'table',
          id: block.id,
          top: cursor,
          height: 0,
          contentWidth: 0,
          colWidths: [],
          tableWidth: 0,
          header: block.header,
          rows: block.rows,
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

    if (visibleCount > 0) cursor += BLOCK_GAP;

    switch (block.tier) {
      case 'prose':
        laidBlock = layoutProse(block, effectiveWidth, fonts, cursor);
        break;
      case 'code':
        laidBlock = layoutCode(block, fonts, cursor, effectiveWidth);
        break;
      case 'island':
        laidBlock = layoutIsland(block, cursor, effectiveWidth, getMeasured(block.id));
        break;
      case 'table':
        laidBlock = layoutTable(block, cursor, effectiveWidth);
        break;
    }

    maxContentWidth = Math.max(maxContentWidth, laidBlock.contentWidth);
    cursor += laidBlock.height;
    visibleCount++;
    laid.push(laidBlock);
  }

  cursor += BUBBLE_PAD_Y;
  const height = cursor + ROW_GAP;

  return { height, width: maxContentWidth, blocks: laid };
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

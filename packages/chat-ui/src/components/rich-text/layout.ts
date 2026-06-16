/**
 * layoutBlocks — generic block-stacking layout.
 *
 * Extracts the per-block layout loop from message/layout.ts into a
 * parameter-driven helper so both the message row and the thinking row share
 * the same geometry core.
 *
 * Responsibilities:
 *   - Stack each block vertically starting at opts.padY.
 *   - Add opts.blockGap between consecutive visible blocks.
 *   - End the content area at cursor + opts.padY.
 *   - Return { height, width, blocks } where height = 2*padY + content height.
 *
 * NOT included (caller owns these):
 *   - ROW_GAP (virtualizer inter-row gap).
 *   - User-bubble hug-width / role logic.
 *   - Empty-blocks fallback height.
 */

import type { Block } from '../../core/blocks/block-types';
import type { BlockLaidOut } from '../../core/layout/layout-types';
import type { FontConfig } from '../../core/measure/fonts';
import { layoutCode } from '../code/layout';
import { layoutIsland } from '../island/layout';
import { layoutProse } from '../prose/layout';
import { layoutTable } from '../table/layout';

export type BlocksLayout = { height: number; width: number; blocks: BlockLaidOut[] };

export type LayoutBlocksOpts = {
  padY: number;
  blockGap: number;
  isCollapsed?: (id: string) => boolean;
  getMeasured?: (id: string) => number | undefined;
};

export function layoutBlocks(
  blocks: Block[],
  width: number,
  fonts: FontConfig,
  opts: LayoutBlocksOpts
): BlocksLayout {
  const isCollapsed = opts.isCollapsed ?? (() => false);
  const getMeasured = opts.getMeasured ?? (() => undefined);

  let cursor = opts.padY;
  let visibleCount = 0;
  let maxContentWidth = 0;
  const laid: BlockLaidOut[] = [];

  for (const block of blocks) {
    const collapsed = isCollapsed(block.id);

    let laidBlock: BlockLaidOut;

    if (collapsed) {
      // Zero-height placeholder keeps block IDs stable in the array.
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

    if (visibleCount > 0) cursor += opts.blockGap;

    switch (block.tier) {
      case 'prose':
        laidBlock = layoutProse(block, width, fonts, cursor);
        break;
      case 'code':
        laidBlock = layoutCode(block, fonts, cursor, width);
        break;
      case 'island':
        laidBlock = layoutIsland(block, cursor, width, getMeasured(block.id));
        break;
      case 'table':
        laidBlock = layoutTable(block, cursor, width);
        break;
    }

    maxContentWidth = Math.max(maxContentWidth, laidBlock.contentWidth);
    cursor += laidBlock.height;
    visibleCount++;
    laid.push(laidBlock);
  }

  cursor += opts.padY;

  return { height: cursor, width: maxContentWidth, blocks: laid };
}

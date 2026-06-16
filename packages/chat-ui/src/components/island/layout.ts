/**
 * layoutIsland — pure geometry for an IslandBlock.
 *
 * Moved here from core/layout/layout-island.ts so that layout logic lives
 * alongside the Island renderer.
 *
 * Islands use a fixed initial height (from ISLAND_FIXED_HEIGHT) that is
 * replaced by an exact DOM-measured height once the content has mounted.
 */

import type { IslandBlock } from '../../core/blocks/block-types';
import { ISLAND_FIXED_HEIGHT } from '../../core/metrics';
import type { IslandLaidOut } from '../../core/layout/layout-types';

export function layoutIsland(
  block: IslandBlock,
  blockTop: number,
  effectiveWidth: number,
  measuredHeight?: number
): IslandLaidOut {
  const height = measuredHeight ?? ISLAND_FIXED_HEIGHT;
  return {
    kind: 'island',
    id: block.id,
    top: blockTop,
    height,
    contentWidth: effectiveWidth,
    islandType: block.islandType,
    raw: block.raw,
  };
}

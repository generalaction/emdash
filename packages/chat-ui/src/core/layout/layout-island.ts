/**
 * layoutIsland — geometry for an IslandBlock.
 */

import type { IslandBlock } from '../blocks/block-types';
import type { FontConfig } from '../measure/fonts';
import type { IslandLaidOut } from './layout-types';

export function layoutIsland(
  block: IslandBlock,
  fonts: FontConfig,
  blockTop: number,
  effectiveWidth: number,
  measuredHeight?: number
): IslandLaidOut {
  const height = measuredHeight ?? fonts.islandFixedHeight;
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

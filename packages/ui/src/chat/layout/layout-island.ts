/**
 * layoutIsland — geometry for an IslandBlock.
 *
 * Islands (table / math / mermaid / image / rule) are either:
 *   a) measured once by the DOM (result stored in LayoutStore.measured map), or
 *   b) given the ISLAND_FIXED_HEIGHT constant initially.
 *
 * The LayoutStore.setMeasured() write-back path updates the cache when the
 * island's rendered height is known, causing the virtualizer to correct positions.
 */

import type { IslandBlock } from '../blocks/block-types';
import type { FontConfig } from '../measure/fonts';
import type { IslandLaidOut } from './layout-types';

export function layoutIsland(
  block: IslandBlock,
  fonts: FontConfig,
  blockTop: number,
  effectiveWidth: number,
  /** DOM-measured height (from LayoutStore.measured), if available. */
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

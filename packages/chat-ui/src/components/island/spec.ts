/**
 * islandSpec — BlockSpec for IslandBlock / IslandLaidOut.
 *
 * Islands have a single geometry constant: the initial fixed height used before
 * DOM measurement produces an exact value.  The exact height is written back
 * by MeasuredBlockFrame via the `onMeasured` callback.
 */

import type { IslandBlock } from '../../core/blocks/block-types';
import type { IslandLaidOut } from '../../core/layout/layout-types';
import type { BlockSpec } from '../../core/layout/spec-types';
import type { FontConfig } from '../../core/measure/fonts';
import { ISLAND_FIXED_HEIGHT } from '../../core/metrics';
import { layoutIsland } from './layout';

export const islandSpec: BlockSpec<IslandBlock, IslandLaidOut> = {
  metrics: {
    fixedHeight: ISLAND_FIXED_HEIGHT,
  },

  cssVars() {
    return {
      '--chat-island-max-h': `${ISLAND_FIXED_HEIGHT}px`,
    };
  },

  layout(
    block: IslandBlock,
    _fonts: FontConfig,
    top: number,
    width: number,
    measured?: number
  ): IslandLaidOut {
    return layoutIsland(block, top, width, measured);
  },
};

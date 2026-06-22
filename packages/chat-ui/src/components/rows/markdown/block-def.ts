import type { DensityScale } from '@core/config';
import type { Measured, MeasureCtx } from '@core/define';
import type { BlockLeafLayout } from '@core/layout/layout-types';
import type { Block } from '@core/markdown/document';
import type { Margin } from '@core/spacing';
import type { JSX } from 'solid-js';

export type { Margin };

export type BlockDef<B extends Block, L extends BlockLeafLayout> = {
  kind: B['kind'];
  /**
   * Optional within-stack vertical margins for this block kind.
   *
   * Receives `density` so values can track runtime theme changes (e.g. a host
   * that increases `proseGap` gets correct gaps without rebuilding defs).
   * At each seam `layoutBlockStack` collapses adjacent margins to
   * max(prev.bottom, cur.top). Hidden/collapsed blocks are skipped.
   * Falls back to `density.blockGap` when absent.
   */
  margin?(density: DensityScale): Margin;
  measure(block: B, ctx: MeasureCtx): Measured<L>;
  Render(props: { node: Measured<L> }): JSX.Element;
};

export function defineBlock<B extends Block, L extends BlockLeafLayout>(
  d: BlockDef<B, L>
): BlockDef<B, L> {
  return d;
}

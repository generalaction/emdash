/**
 * diffRow — RowComponent for ChatDiff.
 *
 * estimate:  cheap constant upper-bound (DIFF_MAX_LINES).
 * measure:   exact — runs computeDiff + selectPreview; returns DiffMeasureResult.
 * Render:    Diff component.
 * cssVars:   re-exported from css-vars.ts and wired into chatCssVars().
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatDiff } from '../../model';
import { Diff } from './Diff';
import { estimateDiff, measureDiff, type DiffMeasureResult } from './measure';

export { diffCssVars } from './css-vars';

function DiffRender(props: { item: ChatDiff; layout: DiffMeasureResult; ctx: RenderCtx }) {
  void props.ctx;
  return <Diff item={props.item} layout={props.layout} />;
}

export const diffRow: RowComponent<ChatDiff, DiffMeasureResult> = {
  estimate(item: ChatDiff, ctx: MeasureCtx): number {
    return estimateDiff(ctx.fonts);
  },

  measure(item: ChatDiff, ctx: MeasureCtx): DiffMeasureResult {
    return measureDiff(item, ctx.fonts);
  },

  Render: DiffRender as Component<{
    item: ChatDiff;
    layout: DiffMeasureResult;
    ctx: RenderCtx;
  }>,
};

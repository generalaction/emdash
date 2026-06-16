/**
 * thinkingRow — RowComponent for ChatThinking.
 *
 * estimate: O(1) character-count heuristic via estimateThinking.
 * measure:  full pretext layout via measureThinking (returns body BlocksLayout
 *           for the Render component to consume directly — no DOM write-back).
 * Render:   Thinking component, receives pre-computed body layout.
 * cssVars:  thinking layout constants.
 *
 * Collapse semantics are inverted for thinking rows: the stored "collapsed" bool
 * is treated as "expanded" — see measure.ts and Thinking.tsx for rationale.
 */

import type { Component } from 'solid-js';
import type { MeasureCtx, RenderCtx, RowComponent } from '../../core/layout/spec-types';
import type { ChatThinking } from '../../model';
import { estimateThinking, measureThinking } from './measure';
import type { ThinkingMeasureResult } from './measure';
import { Thinking } from './Thinking';

export { thinkingCssVars } from './css-vars';

export type ThinkingRowLayout = ThinkingMeasureResult;

function ThinkingRender(props: { item: ChatThinking; layout: ThinkingRowLayout; ctx: RenderCtx }) {
  return (
    <Thinking
      item={props.item}
      collapsed={props.ctx.viewState.isCollapsed(props.item.id)}
      body={props.layout.body}
      preview={props.layout.preview}
    />
  );
}

export const thinkingRow: RowComponent<ChatThinking, ThinkingRowLayout> = {
  estimate(item: ChatThinking, ctx: MeasureCtx): number {
    // isCollapsed serves as isExpanded here — see measure.ts for the inversion rationale.
    return estimateThinking(item, ctx.isCollapsed, ctx.fonts);
  },

  measure(item: ChatThinking, ctx: MeasureCtx): ThinkingRowLayout {
    return measureThinking(item, ctx.isCollapsed, ctx.fonts, ctx.rowWidth);
  },

  Render: ThinkingRender as Component<{
    item: ChatThinking;
    layout: ThinkingRowLayout;
    ctx: RenderCtx;
  }>,
};

/**
 * thinkingDef — ComponentDef for ChatThinking rows.
 *
 * estimate: O(1) character-count heuristic.
 * measure:  full pretext layout via layoutBlocks; returns body/preview
 *           BlocksLayout for the Render component to consume directly.
 *
 * Collapse semantics are inverted: the stored "collapsed" bool means
 * "expanded" — default absent/false → preview (active) or header-only (done).
 *
 * The bespoke `measureThinking` / `estimateThinking` functions from
 * thinking/measure.ts are inlined here; that file is deleted.
 */

import type { Block } from '../../core/blocks/block-types';
import {
  downgradeIslandsToText,
  flattenHeadings,
  parseBlocksCached,
} from '../../core/blocks/parse-blocks';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatThinking } from '../../model';
import type { BlocksLayout } from '../rich-text/layout';
import { layoutBlocks } from '../rich-text/layout';
import { Thinking } from './Thinking';

export type ThinkingLayout = {
  kind: 'thinking';
  body?: BlocksLayout;
  preview?: BlocksLayout;
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildThinkingBlocks(item: ChatThinking): Block[] {
  return downgradeIslandsToText(flattenHeadings(parseBlocksCached(item.id, item.text ?? '')));
}

function layoutThinkingBody(blocks: Block[], ctx: MeasureCtx): BlocksLayout {
  const bodyWidth = ctx.width - 2 * ctx.theme.geometry.rowInsetX;
  const { thinkingPadY, blockGap, proseGap } = ctx.theme.geometry;
  return layoutBlocks(blocks, bodyWidth, ctx.theme.fonts, {
    padY: thinkingPadY,
    blockGap,
    proseGap,
    getMeasured: () => undefined,
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function ThinkingRender(props: {
  item: ChatThinking;
  layout: Measured<ThinkingLayout>;
  ctx: RenderCtx;
}) {
  return (
    <Thinking
      item={props.item}
      collapsed={props.ctx.viewState.isCollapsed(props.item.id)}
      body={props.layout.layout.body}
      preview={props.layout.layout.preview}
    />
  );
}

// ── ComponentDef ──────────────────────────────────────────────────────────────

export const thinkingDef = defineComponent<ChatThinking, ThinkingLayout>({
  kind: 'thinking',

  estimate(item, ctx: MeasureCtx): number {
    const { thinkingHeaderH, thinkingWindowH, thinkingPadY } = ctx.theme.geometry;
    // isCollapsed serves as isExpanded (inverted semantics)
    const isExpanded = ctx.isCollapsed(item.id);

    if (!isExpanded) {
      if (item.status === 'thinking') return thinkingHeaderH + thinkingWindowH;
      return thinkingHeaderH;
    }

    const lines = Math.max(1, Math.ceil((item.text?.length ?? 0) / 60));
    return thinkingHeaderH + 2 * thinkingPadY + lines * ctx.theme.fonts.body.lineHeight;
  },

  measure(item, ctx: MeasureCtx): Measured<ThinkingLayout> {
    const { thinkingHeaderH, thinkingWindowH } = ctx.theme.geometry;
    const isExpanded = ctx.isCollapsed(item.id);

    if (!isExpanded) {
      const height =
        item.status === 'thinking' ? thinkingHeaderH + thinkingWindowH : thinkingHeaderH;

      if (item.status === 'thinking') {
        const blocks = buildThinkingBlocks(item);
        const preview = layoutThinkingBody(blocks, ctx);
        return { height, width: ctx.width, layout: { kind: 'thinking', preview } };
      }

      return { height, width: ctx.width, layout: { kind: 'thinking' } };
    }

    // Expanded: full body layout
    const blocks = buildThinkingBlocks(item);
    const body = layoutThinkingBody(blocks, ctx);
    return {
      height: thinkingHeaderH + body.height,
      width: ctx.width,
      layout: { kind: 'thinking', body },
    };
  },

  Render: ThinkingRender,
});

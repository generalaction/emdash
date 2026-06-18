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
import { buildThinkingBlocks } from '../../core/blocks/parse-blocks';
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

/** Vertical padding (px) inside the expanded thinking body block stack. */
const THINKING_PAD_Y = 8;
/** Preview window height (px) during active thinking. */
const THINKING_WINDOW_H = 72;

// ── Shared helpers ────────────────────────────────────────────────────────────

function thinkingHeaderH(ctx: MeasureCtx): number {
  return ctx.theme.fonts.body.lineHeight + 8;
}

function layoutThinkingBody(blocks: Block[], ctx: MeasureCtx): BlocksLayout {
  const { blockGap, proseGap } = ctx.theme.density;
  return layoutBlocks(blocks, ctx.width, ctx.theme.fonts, {
    padY: THINKING_PAD_Y,
    blockGap,
    proseGap,
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

  collapse: { mode: 'inverted', default: false },

  estimate(item, ctx: MeasureCtx): number {
    const headerH = thinkingHeaderH(ctx);
    const isExpanded = ctx.expanded(item.id);

    if (!isExpanded) {
      if (item.status === 'thinking') return headerH + THINKING_WINDOW_H;
      return headerH;
    }

    const lines = Math.max(1, Math.ceil((item.text?.length ?? 0) / 60));
    return headerH + 2 * THINKING_PAD_Y + lines * ctx.theme.fonts.body.lineHeight;
  },

  measure(item, ctx: MeasureCtx): Measured<ThinkingLayout> {
    const headerH = thinkingHeaderH(ctx);
    const isExpanded = ctx.expanded(item.id);

    if (!isExpanded) {
      const height =
        item.status === 'thinking' ? headerH + THINKING_WINDOW_H : headerH;

      if (item.status === 'thinking') {
        const blocks = buildThinkingBlocks(item.id, item.text);
        const preview = layoutThinkingBody(blocks, ctx);
        return { height, width: ctx.width, layout: { kind: 'thinking', preview } };
      }

      return { height, width: ctx.width, layout: { kind: 'thinking' } };
    }

    // Expanded: full body layout
    const blocks = buildThinkingBlocks(item.id, item.text);
    const body = layoutThinkingBody(blocks, ctx);
    return {
      height: headerH + body.height,
      width: ctx.width,
      layout: { kind: 'thinking', body },
    };
  },

  Render: ThinkingRender,
});

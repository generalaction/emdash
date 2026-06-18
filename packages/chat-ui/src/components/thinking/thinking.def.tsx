/**
 * thinkingDef — ComponentDef for ChatThinking rows.
 *
 * estimate: O(1) character-count heuristic.
 * measure:  builds a compose Measured tree and stores it in ThinkingLayout.tree.
 *
 *   done + not expanded:   collapsible({ headerSlot, expanded: false })
 *   active + not expanded: stack([ slot(header), scrollWindow(blockStack, WINDOW_H, { overlay, autoScroll }) ])
 *   expanded:              stack([ slot(header), blockStack ])
 *
 * Collapse semantics are inverted: the stored "collapsed" bool means
 * "expanded" — default absent/false → preview (active) or header-only (done).
 *
 * The expanded/active branch is now chosen once in measure() via ctx.expanded,
 * so Render cannot diverge from measure (fixes the old ctx.viewState split).
 *
 * ThinkingRender is a thin shell that supplies the 'thinking:header' slot
 * (ThinkingHeader component) and delegates entirely to Project.
 */

import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { Block } from '../../core/blocks/block-types';
import { buildThinkingBlocks } from '../../core/blocks/parse-blocks';
import { collapsible, scrollWindow, slot, stack } from '../../core/compose';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import type { ChatThinking } from '../../model';
import { Project, renderBlockLeaf } from '../Project';
import { CollapseHeader } from '../primitives/CollapseHeader';
import { useTheme } from '../ThemeContext';

// ── Module constants ─────────────────────────────────────────────────────────

/** Vertical padding (px) inside the expanded thinking body block stack. */
const THINKING_PAD_Y = 8;
/** Preview window height (px) during active thinking. */
const THINKING_WINDOW_H = 72;

// ── Shared helpers ────────────────────────────────────────────────────────────

function thinkingHeaderH(ctx: MeasureCtx): number {
  return ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
}

function layoutThinkingBody(blocks: Block[], ctx: MeasureCtx): Measured {
  const { blockGap, proseGap } = ctx.theme.density;
  return layoutBlockStack(blocks, ctx, {
    padY: THINKING_PAD_Y,
    blockGap,
    proseGap,
  });
}

// ── Layout type ───────────────────────────────────────────────────────────────

export type ThinkingLayout = {
  kind: 'thinking';
  /**
   * The compose subtree produced by measure().  Varies by expanded/active state.
   * Project walks this in ThinkingRender.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- compose tree; structure varies by state
  tree: Measured<any>;
};

// ── ThinkingHeader (slot component) ───────────────────────────────────────────

function ThinkingHeader(props: { item: ChatThinking; expanded: boolean; headerH: number }) {
  const startElapsed = Math.floor((Date.now() - props.item.startedAt) / 1000);
  const [elapsed, setElapsed] = createSignal(startElapsed);

  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (props.item.status === 'thinking') {
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - props.item.startedAt) / 1000));
      }, 1000);
    } else {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => clearInterval(timer));

  const label = () => {
    if (props.item.status === 'thinking') return `Thinking ${elapsed()}s`;
    if (props.item.durationMs !== undefined)
      return `Thought for ${Math.floor(props.item.durationMs / 1000)}s`;
    return 'Thought';
  };

  return (
    <CollapseHeader
      id={props.item.id}
      expanded={props.expanded}
      active={props.item.status === 'thinking'}
      height={props.headerH}
    >
      <span
        aria-live={props.item.status === 'thinking' ? 'polite' : undefined}
        aria-atomic={props.item.status === 'thinking' ? 'false' : undefined}
      >
        {label()}
      </span>
    </CollapseHeader>
  );
}

// ── Render ────────────────────────────────────────────────────────────────────

function ThinkingRender(props: {
  item: ChatThinking;
  layout: Measured<ThinkingLayout>;
  ctx: RenderCtx;
}) {
  const theme = useTheme();
  const headerH = () => theme().fonts.body.lineHeight + HEADER_ROW_EXTRA_H;

  // Inverted semantics: stored "collapsed" flag is treated as "expanded".
  const expanded = () => props.ctx.viewState.isCollapsed(props.item.id);

  return (
    <div class="text-foreground-passive" style={{ position: 'relative', height: `${props.layout.height}px` }}>
      <Project
        node={props.layout.layout.tree}
        slots={{
          'thinking:header': () => (
            <ThinkingHeader
              item={props.item}
              expanded={expanded()}
              headerH={headerH()}
            />
          ),
        }}
      >
        {renderBlockLeaf}
      </Project>
    </div>
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
    const headerSlot = 'thinking:header';

    // ── Done + not expanded: header only ─────────────────────────────────────
    if (!isExpanded && item.status !== 'thinking') {
      const tree = collapsible({ headerH, headerSlot, expanded: false });
      return { height: tree.height, width: ctx.width, layout: { kind: 'thinking', tree } };
    }

    // ── Active + not expanded: header + scrollWindow preview ─────────────────
    if (!isExpanded) {
      const blocks = buildThinkingBlocks(item.id, item.text);
      const body = layoutThinkingBody(blocks, ctx);
      const preview = scrollWindow(body, THINKING_WINDOW_H, {
        overlay: 'fade-top',
        autoScrollBottom: true,
      });
      const tree = stack(
        [
          { id: `${item.id}:header`, measured: slot(headerSlot, headerH) },
          { id: `${item.id}:preview`, measured: preview },
        ],
        { gap: 0 }
      );
      return { height: tree.height, width: ctx.width, layout: { kind: 'thinking', tree } };
    }

    // ── Expanded: header + full body ─────────────────────────────────────────
    const blocks = buildThinkingBlocks(item.id, item.text);
    const body = layoutThinkingBody(blocks, ctx);
    const tree = collapsible({ headerH, headerSlot, expanded: true, body });
    return { height: tree.height, width: ctx.width, layout: { kind: 'thinking', tree } };
  },

  Render: ThinkingRender,
});

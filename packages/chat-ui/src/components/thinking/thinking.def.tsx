/**
 * thinkingUnitDef — native UnitDef for ChatThinking rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render lays out ThinkingHeader + optional body/preview internally.
 *
 * Collapse semantics are inverted: stored "collapsed" flag means "expanded".
 *   done + not expanded:   header only
 *   active + not expanded: header + PreviewWindow (auto-scrolls to bottom)
 *   expanded:              header + full block stack
 *
 * Geometry constants are declared in `vars` — the single source of truth for
 * thinking row geometry.
 */

import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { MeasureCtx, RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import type { Block } from '../../core/markdown/document';
import { flattenBlockHeadings } from '../../core/markdown/parse';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatThinking } from '../../model';
import { BlockStackView } from '../primitives/BlockStackView';
import { CollapseHeader } from '../primitives/CollapseHeader';
import { PreviewWindow } from '../primitives/PreviewWindow';
import { useTheme } from '../ThemeContext';

// ── vars type ─────────────────────────────────────────────────────────────────

export type ThinkingVars = {
  /** Vertical padding (px) inside the expanded thinking body block stack. */
  padY: number;
  /** Preview window height (px) during active thinking. */
  windowH: number;
};

const THINKING_VARS: ThinkingVars = {
  padY: 8,
  windowH: 72,
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function thinkingHeaderH(ctx: MeasureCtx): number {
  return ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
}

function layoutThinkingBody(blocks: Block[], ctx: MeasureCtx, padY: number) {
  const { blockGap, proseGap } = ctx.theme.density;
  return layoutBlockStack(blocks, ctx, { padY, blockGap, proseGap });
}

// ── ThinkingHeader ────────────────────────────────────────────────────────────

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

// ── Measure ───────────────────────────────────────────────────────────────────

function thinkingMeasure(item: ChatThinking, ctx: MeasureCtx, vars: ThinkingVars): number {
  const headerH = thinkingHeaderH(ctx);
  const isExpanded = ctx.expanded(item.id);

  if (!isExpanded && item.status !== 'thinking') return headerH;

  const blocks = flattenBlockHeadings(ctx.caches.parseBlocks(item.id, item.text ?? ''));
  const body = layoutThinkingBody(blocks, ctx, vars.padY);

  if (!isExpanded) return headerH + vars.windowH;
  return headerH + body.height;
}

// ── Render ────────────────────────────────────────────────────────────────────

function ThinkingUnitRender(props: { data: ChatThinking; ctx: RenderCtx; vars: ThinkingVars }) {
  const theme = useTheme();
  const mCtx = () => props.ctx.measureCtx?.();
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const headerH = () => theme().fonts.body.lineHeight + HEADER_ROW_EXTRA_H;

  const body = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = flattenBlockHeadings(
      ctx.caches.parseBlocks(props.data.id, props.data.text ?? '')
    );
    return layoutThinkingBody(blocks, ctx, props.vars.padY);
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return headerH();
    return thinkingMeasure(props.data, ctx, props.vars);
  });

  const showBody = () => isExpanded() || props.data.status === 'thinking';
  const bodyH = () => body()?.height ?? 0;

  return (
    <div class="text-chat-fg-passive" style={{ height: `${totalH()}px` }}>
      <ThinkingHeader item={props.data} expanded={isExpanded()} headerH={headerH()} />
      <Show when={showBody()}>
        <Show
          when={isExpanded()}
          fallback={
            // Collapsed + active: scrollable preview window auto-scrolling to bottom.
            <PreviewWindow
              height={props.vars.windowH}
              maxH={props.vars.windowH}
              overlay="fade-top"
              autoScrollBottom={props.data.status === 'thinking'}
              contentHeight={() => bodyH()}
            >
              <Show when={body()}>{(b) => <BlockStackView node={b()} />}</Show>
            </PreviewWindow>
          }
        >
          {/* Expanded: full body */}
          <Show when={body()}>{(b) => <BlockStackView node={b()} />}</Show>
        </Show>
      </Show>
    </div>
  );
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const thinkingUnitDef = defineUnit<ChatThinking, ThinkingVars>({
  kind: 'thinking',
  vars: THINKING_VARS,

  estimate(item, ctx, vars): number {
    const headerH = thinkingHeaderH(ctx);
    const isExpanded = ctx.expanded(item.id);

    if (!isExpanded) {
      if (item.status === 'thinking') return headerH + vars.windowH;
      return headerH;
    }

    const lines = Math.max(1, Math.ceil((item.text?.length ?? 0) / 60));
    return headerH + 2 * vars.padY + lines * ctx.theme.fonts.body.lineHeight;
  },

  measure: thinkingMeasure,

  Render: ThinkingUnitRender,
});

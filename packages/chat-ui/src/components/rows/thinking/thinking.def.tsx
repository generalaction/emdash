import { useTheme } from '@components/contexts/ThemeContext';
import { BlockStackView } from '@components/primitives/BlockStackView';
import { CollapseHeader } from '@components/primitives/CollapseHeader';
import { PreviewWindow } from '@components/primitives/PreviewWindow';
import type { MeasureCtx, RenderCtx } from '@core/define';
import { layoutBlockStack } from '@core/layout/block-stack';
import type { Block } from '@core/markdown/document';
import { flattenBlockHeadings } from '@core/markdown/parse';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { ChatThinking } from '@/model';
import { thinkingCardVars, thinkingRoot, type ThinkingStyleVars } from './thinking.css';
import { sx } from '@styles/sprinkles.css';

export type ThinkingVars = {
  /** Style-relevant: vertical padding inside the expanded body. Consumed by thinkingCardVars. */
  padY: number;
  /** Measure-only: preview window height during active thinking. */
  windowH: number;
};

const THINKING_VARS: ThinkingVars = {
  padY: 8,
  windowH: 72,
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function thinkingHeaderH(ctx: MeasureCtx): number {
  return ctx.theme.fonts.body.lineHeight + ctx.theme.density.headerRowExtraH;
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

  const headerH = () => theme().fonts.body.lineHeight + theme().density.headerRowExtraH;

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

  const styleVars = (): ThinkingStyleVars => ({ height: totalH(), padY: props.vars.padY });

  return (
    <div
      class={`${sx({ color: 'fgPassive' })} ${thinkingRoot}`}
      style={assignInlineVars(thinkingCardVars, pxTokens(styleVars()))}
    >
      <ThinkingHeader item={props.data} expanded={isExpanded()} headerH={headerH()} />
      <Show when={showBody()}>
        <Show
          when={isExpanded()}
          fallback={
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

import { BlockStackView } from '@components/primitives/BlockStackView';
import { CopyButton } from '@components/primitives/CopyButton';
import type { StackLayout } from '@core/compose';
import type { MeasureCtx, Measured, RenderCtx } from '@core/define';
import { layoutBlockStack } from '@core/layout/block-stack';
import { blockPlainText } from '@core/markdown/plain-text';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { Show, createMemo } from 'solid-js';
import type { ChatMessage } from '@/model';
import { type MessageVars, userInnerWidth } from './metrics';
import { UserMessageCard } from './UserMessageCard';
import {
  assistantOuter,
  assistantRoot,
  assistantVars,
  footerRow,
  messageText,
  srOnly,
} from './message.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function attachH(count: number, innerW: number, vars: MessageVars): number {
  if (count <= 0) return 0;
  const { attachThumb: thumb, attachGap: gap } = vars;
  const perRow = Math.max(1, Math.floor((innerW + gap) / (thumb + gap)));
  const rows = Math.ceil(count / perRow);
  return rows * thumb + (rows - 1) * gap + gap;
}

// ── Measure ───────────────────────────────────────────────────────────────────

export function measureMessage(item: ChatMessage, ctx: MeasureCtx, vars: MessageVars): number {
  const { userCardPadY, cardBorder, collapsedMaxH, expandedMaxH, stackPadY } = vars;
  const { blockGap, proseGap } = ctx.theme.density;
  const blocks = ctx.caches.parseBlocks(item.id, item.text);

  if (item.role === 'user') {
    const innerW = userInnerWidth(ctx.width, vars);
    const aH = attachH(item.attachments?.length ?? 0, innerW, vars);
    if (blocks.length === 0) {
      const fallback = aH + ctx.theme.fonts.body.lineHeight + 2 * userCardPadY + 2 * cardBorder;
      return Math.min(fallback, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
    }
    const innerCtx = { ...ctx, width: innerW };
    // stackPadY is the block stack's internal vertical padding; userCardPadY is applied by CSS.
    const stack = layoutBlockStack(blocks, innerCtx, {
      padY: stackPadY,
      blockGap,
      proseGap,
      isCollapsed: ctx.isCollapsed,
    });
    const contentH = aH + stack.height + 2 * userCardPadY + 2 * cardBorder;
    return Math.min(contentH, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
  }

  // assistant / thought
  const footer = item.role === 'assistant' ? vars.footerH : 0;
  if (blocks.length === 0) {
    return ctx.theme.fonts.body.lineHeight + 2 * stackPadY + footer;
  }
  const stack = layoutBlockStack(blocks, ctx, {
    padY: stackPadY,
    blockGap,
    proseGap,
    isCollapsed: ctx.isCollapsed,
  });
  return stack.height + footer;
}

function AssistantRender(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  const mCtx = () => props.ctx.measureCtx?.();

  const stackOpts = () => {
    const ctx = mCtx();
    return {
      padY: props.vars.stackPadY,
      blockGap: ctx?.theme.density.blockGap ?? 10,
      proseGap: ctx?.theme.density.proseGap ?? 4,
    };
  };

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) return null;
    return layoutBlockStack(blocks, ctx, { ...stackOpts(), isCollapsed: ctx.isCollapsed });
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.data.role === 'assistant' ? props.vars.footerH : 0;
    return measureMessage(props.data, ctx, props.vars);
  });

  const plainText = () => {
    const ctx = mCtx();
    if (!ctx) return props.data.text;
    return ctx.caches.parseBlocks(props.data.id, props.data.text).map(blockPlainText).join('\n\n');
  };

  const role = () =>
    (props.data.role === 'thought' ? 'thought' : 'assistant') as 'thought' | 'assistant';

  return (
    <div
      class={`${assistantOuter} ${messageText({ role: role() })} ${assistantRoot}`}
      style={assignInlineVars(assistantVars, pxTokens({ height: totalH() }))}
    >
      <div class={srOnly}>{plainText()}</div>
      <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
      <Show when={props.data.role === 'assistant'}>
        <div
          class={footerRow}
          style={{ height: `${props.vars.footerH}px` }}
          aria-hidden={props.data.streaming ? 'true' : undefined}
        >
          <Show when={!props.data.streaming}>
            <CopyButton text={props.data.text} variant="inline" label="Copy message" />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── MessageUnitRender ─────────────────────────────────────────────────────────

function MessageUnitRender(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  if (props.data.role === 'user') {
    return <UserMessageCard data={props.data} ctx={props.ctx} vars={props.vars} />;
  }
  return <AssistantRender data={props.data} ctx={props.ctx} vars={props.vars} />;
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const messageUnitDef = defineUnit<ChatMessage, MessageVars>({
  kind: 'message',
  vars: {
    cardBorder: 1,
    collapsedMaxH: 120,
    expandedMaxH: 360,
    userCardPadX: 16,
    userCardPadY: 16,
    stackPadY: 6,
    attachThumb: 32,
    attachGap: 8,
    footerH: 24,
  },

  estimate(item, ctx, vars): number {
    if (item.role === 'user') {
      const innerW = userInnerWidth(ctx.width, vars);
      const lines = Math.max(1, Math.ceil(item.text.length / 60));
      const aH = attachH(item.attachments?.length ?? 0, innerW, vars);
      const est =
        aH +
        lines * ctx.theme.fonts.body.lineHeight +
        2 * vars.stackPadY +
        2 * vars.userCardPadY +
        2 * vars.cardBorder;
      return Math.min(est, ctx.expandedId === item.id ? vars.expandedMaxH : vars.collapsedMaxH);
    }
    const lines = Math.max(1, Math.ceil(item.text.length / 60));
    const footer = item.role === 'assistant' ? vars.footerH : 0;
    return lines * ctx.theme.fonts.body.lineHeight + 2 * vars.stackPadY + footer;
  },

  measure: measureMessage,

  Render: MessageUnitRender,
});

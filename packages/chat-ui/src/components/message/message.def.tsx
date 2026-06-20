/**
 * messageUnitDef — native UnitDef for ChatMessage rows.
 *
 * Single self-contained unit per message. Rendering and measurement branch on role:
 *
 *   user      — bordered card (border-chat-border, bg-chat-bg-1), full column width
 *               (no inset), bubblePadX horizontal / bubblePadY vertical internal padding.
 *               Collapsed max-height: vars.collapsedMaxH (120px), clipped.
 *               Expanded max-height: vars.expandedMaxH (360px), scrollable.
 *               Expand state driven by ctx.expandedId === item.id.
 *               Rendered via UserMessageCard (shared with PinnedUserMessage).
 *
 *   assistant — plain inset row (chrome: COMPOSITE_CHROME via unit-registry),
 *               block stack + vars.footerH copy-button row.
 *
 *   thought   — same inset row, muted italic text, no footer.
 *
 * All states (streaming/empty/finalized) map to one stable unit (key='self').
 *
 * All layout constants are declared in `messageUnitDef.vars` (MESSAGE_VARS).
 * UserMessageCard.tsx also holds module-level defaults for backward compatibility.
 */

import { Show, createMemo } from 'solid-js';
import type { StackLayout } from '../../core/compose';
import type { MeasureCtx, Measured, RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { blockPlainText } from '../../core/markdown/plain-text';
import { defineUnit } from '../../core/units';
import type { ChatMessage } from '../../model';
import { BlockStackView } from '../primitives/BlockStackView';
import { CopyButton } from '../primitives/CopyButton';
import {
  ATTACH_GAP,
  ATTACH_THUMB,
  BLOCK_GAP,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  PROSE_GAP,
  USER_CARD_BORDER,
  USER_COLLAPSED_MAX_H,
  USER_EXPANDED_MAX_H,
  type MessageVars,
  UserMessageCard,
  userInnerWidth,
} from './UserMessageCard';

// ── vars ──────────────────────────────────────────────────────────────────────

const MESSAGE_VARS: MessageVars = {
  cardBorder: USER_CARD_BORDER,
  collapsedMaxH: USER_COLLAPSED_MAX_H,
  expandedMaxH: USER_EXPANDED_MAX_H,
  bubblePadX: BUBBLE_PAD_X,
  bubblePadY: BUBBLE_PAD_Y,
  blockGap: BLOCK_GAP,
  proseGap: PROSE_GAP,
  attachThumb: ATTACH_THUMB,
  attachGap: ATTACH_GAP,
  footerH: 24,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Height of the attachment thumbnail strip, or 0 if no attachments. */
function attachH(count: number, innerW: number, vars: MessageVars): number {
  if (count <= 0) return 0;
  const { attachThumb: thumb, attachGap: gap } = vars;
  const perRow = Math.max(1, Math.floor((innerW + gap) / (thumb + gap)));
  const rows = Math.ceil(count / perRow);
  return rows * thumb + (rows - 1) * gap + gap; // + bottom gap
}

// ── Measure ───────────────────────────────────────────────────────────────────

export function measureMessage(item: ChatMessage, ctx: MeasureCtx, vars: MessageVars): number {
  const { bubblePadY: padY, cardBorder: border, collapsedMaxH, expandedMaxH } = vars;
  const stackOpts = { padY, blockGap: vars.blockGap, proseGap: vars.proseGap };
  const blocks = ctx.caches.parseBlocks(item.id, item.text);

  if (item.role === 'user') {
    const innerW = userInnerWidth(ctx.width, vars);
    const aH = attachH(item.attachments?.length ?? 0, innerW, vars);
    if (blocks.length === 0) {
      const fallback = aH + ctx.theme.fonts.body.lineHeight + 2 * padY + 2 * border;
      return Math.min(fallback, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
    }
    const innerCtx = { ...ctx, width: innerW };
    const stack = layoutBlockStack(blocks, innerCtx, { ...stackOpts, isCollapsed: ctx.isCollapsed });
    const contentH = aH + stack.height + 2 * padY + 2 * border;
    return Math.min(contentH, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
  }

  // assistant / thought
  const footer = item.role === 'assistant' ? vars.footerH : 0;
  if (blocks.length === 0) {
    return ctx.theme.fonts.body.lineHeight + 2 * padY + footer;
  }
  const stack = layoutBlockStack(blocks, ctx, { ...stackOpts, isCollapsed: ctx.isCollapsed });
  return stack.height + footer;
}

// ── Assistant / thought render ────────────────────────────────────────────────

function AssistantRender(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  const mCtx = () => props.ctx.measureCtx?.();

  const stackOpts = () => ({
    padY: props.vars.bubblePadY,
    blockGap: props.vars.blockGap,
    proseGap: props.vars.proseGap,
  });

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

  const textClass = () =>
    props.data.role === 'thought' ? 'text-chat-fg-muted italic' : 'text-chat-fg-body';

  const plainText = () => {
    const ctx = mCtx();
    if (!ctx) return props.data.text;
    return ctx.caches.parseBlocks(props.data.id, props.data.text).map(blockPlainText).join('\n\n');
  };

  return (
    <div class={`group ${textClass()}`} style={{ height: `${totalH()}px`, position: 'relative' }}>
      <div class="sr-only">{plainText()}</div>
      <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
      <Show when={props.data.role === 'assistant'}>
        <div
          class="flex items-center"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${props.vars.footerH}px`,
          }}
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
  vars: MESSAGE_VARS,

  estimate(item, ctx, vars): number {
    if (item.role === 'user') {
      const innerW = userInnerWidth(ctx.width, vars);
      const lines = Math.max(1, Math.ceil(item.text.length / 60));
      const aH = attachH(item.attachments?.length ?? 0, innerW, vars);
      const est =
        aH + lines * ctx.theme.fonts.body.lineHeight + 2 * vars.bubblePadY + 2 * vars.cardBorder;
      return Math.min(
        est,
        ctx.expandedId === item.id ? vars.expandedMaxH : vars.collapsedMaxH
      );
    }
    const lines = Math.max(1, Math.ceil(item.text.length / 60));
    const footer = item.role === 'assistant' ? vars.footerH : 0;
    return lines * ctx.theme.fonts.body.lineHeight + 2 * vars.bubblePadY + footer;
  },

  measure: measureMessage,

  Render: MessageUnitRender,
});

/**
 * messageUnitDef — native UnitDef for ChatMessage rows.
 *
 * Single self-contained unit per message. Rendering and measurement branch on role:
 *
 *   user      — bordered card (border-chat-border, bg-chat-bg-1), full column width
 *               (no inset), 12px horizontal / 6px vertical internal padding.
 *               Collapsed max-height: USER_COLLAPSED_MAX_H (120px), clipped.
 *               Expanded max-height: USER_EXPANDED_MAX_H (360px), scrollable.
 *               Expand state driven by ctx.expandedId === item.id.
 *               Rendered via UserMessageCard (shared with PinnedUserMessage).
 *
 *   assistant — plain inset row (chrome: COMPOSITE_CHROME via unit-registry),
 *               block stack + MESSAGE_FOOTER_H copy-button row.
 *
 *   thought   — same inset row, muted italic text, no footer.
 *
 * All states (streaming/empty/finalized) map to one stable unit (key='self').
 *
 * Layout constants (USER_CARD_BORDER, BUBBLE_PAD_X, BUBBLE_PAD_Y, BLOCK_GAP,
 * PROSE_GAP, USER_COLLAPSED_MAX_H, USER_EXPANDED_MAX_H) live in UserMessageCard.tsx
 * so that file is self-contained and PinnedUserMessage can import from it directly
 * without creating a circular dependency.
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
  attachmentsStripHeight,
  BLOCK_GAP,
  BUBBLE_PAD_Y,
  PROSE_GAP,
  USER_CARD_BORDER,
  USER_COLLAPSED_MAX_H,
  USER_EXPANDED_MAX_H,
  UserMessageCard,
  userInnerWidth,
} from './UserMessageCard';

// ── Re-export constants for external consumers (PinnedUserMessage, tests) ─────
export {
  BLOCK_GAP,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  PROSE_GAP,
  USER_CARD_BORDER,
  USER_COLLAPSED_MAX_H,
  USER_EXPANDED_MAX_H,
} from './UserMessageCard';

/** Reserved height for the assistant message footer (copy button row, px). */
export const MESSAGE_FOOTER_H = 24;

// ── Shared stack opts ────────────────────────────────────────────────────────

const STACK_OPTS = { padY: BUBBLE_PAD_Y, blockGap: BLOCK_GAP, proseGap: PROSE_GAP };

// ── measure ───────────────────────────────────────────────────────────────────

export function measureMessage(item: ChatMessage, ctx: MeasureCtx): number {
  const blocks = ctx.caches.parseBlocks(item.id, item.text);

  if (item.role === 'user') {
    const innerW = userInnerWidth(ctx.width);
    const innerCtx = { ...ctx, width: innerW };
    const attachH = attachmentsStripHeight(item.attachments?.length ?? 0, innerW);
    if (blocks.length === 0) {
      const fallback =
        attachH + ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + 2 * USER_CARD_BORDER;
      return Math.min(
        fallback,
        ctx.expandedId === item.id ? USER_EXPANDED_MAX_H : USER_COLLAPSED_MAX_H
      );
    }
    const stack = layoutBlockStack(blocks, innerCtx, {
      ...STACK_OPTS,
      isCollapsed: ctx.isCollapsed,
    });
    const contentH = attachH + stack.height + 2 * BUBBLE_PAD_Y + 2 * USER_CARD_BORDER;
    return Math.min(
      contentH,
      ctx.expandedId === item.id ? USER_EXPANDED_MAX_H : USER_COLLAPSED_MAX_H
    );
  }

  // assistant / thought
  const footer = item.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
  if (blocks.length === 0) {
    return ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + footer;
  }
  const stack = layoutBlockStack(blocks, ctx, { ...STACK_OPTS, isCollapsed: ctx.isCollapsed });
  return stack.height + footer;
}

// ── Assistant / thought render ────────────────────────────────────────────────

function AssistantRender(props: { data: ChatMessage; ctx: RenderCtx }) {
  const mCtx = () => props.ctx.measureCtx?.();

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) return null;
    return layoutBlockStack(blocks, ctx, { ...STACK_OPTS, isCollapsed: ctx.isCollapsed });
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.data.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
    return measureMessage(props.data, ctx);
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
            height: `${MESSAGE_FOOTER_H}px`,
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

function MessageUnitRender(props: { data: ChatMessage; ctx: RenderCtx }) {
  if (props.data.role === 'user') {
    return <UserMessageCard data={props.data} ctx={props.ctx} />;
  }
  return <AssistantRender data={props.data} ctx={props.ctx} />;
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const messageUnitDef = defineUnit<ChatMessage>({
  kind: 'message',
  estimate(item, ctx): number {
    if (item.role === 'user') {
      const lines = Math.max(1, Math.ceil(item.text.length / 60));
      const attachH = attachmentsStripHeight(
        item.attachments?.length ?? 0,
        userInnerWidth(ctx.width)
      );
      const est =
        attachH + lines * ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + 2 * USER_CARD_BORDER;
      return Math.min(est, ctx.expandedId === item.id ? USER_EXPANDED_MAX_H : USER_COLLAPSED_MAX_H);
    }
    const lines = Math.max(1, Math.ceil(item.text.length / 60));
    const footer = item.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
    return lines * ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + footer;
  },
  measure: measureMessage,
  Render: MessageUnitRender,
});

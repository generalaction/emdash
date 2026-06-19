/**
 * UserMessageCard — the bordered, filled card used for user-role messages.
 *
 * Used by both:
 *   - messageUnitDef.Render (inline virtualized row) via message.def.tsx
 *   - PinnedUserMessage (sticky overlay)
 *
 * This file owns the shared user-card layout constants so that message.def.tsx
 * can import them from here without creating a circular dependency.
 *
 * Expand state is driven by `ctx.measureCtx?.()?.expandedId === data.id`.
 * When collapsed (default) the card clips at USER_COLLAPSED_MAX_H (120px).
 * When expanded the card shows up to USER_EXPANDED_MAX_H (360px) with an
 * internal scrollbar. At most one card can be expanded at a time (enforced
 * by the single expandedUserId signal in ChatRoot).
 */

import { Show, createMemo } from 'solid-js';
import type { StackLayout } from '../../core/compose';
import type { Measured, RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { blockPlainText } from '../../core/markdown/plain-text';
import type { ChatMessage } from '../../model';
import { BlockStackView } from '../primitives/BlockStackView';

// ── Layout constants (imported by message.def.tsx — keep in sync) ────────────

/** Border width (px) on each side of the user card. */
export const USER_CARD_BORDER = 1;
/** Max-height (px) of a collapsed user message card. */
export const USER_COLLAPSED_MAX_H = 120;
/** Max-height (px) of an expanded user message card (with internal scroll). */
export const USER_EXPANDED_MAX_H = 360;
/** Horizontal padding inside the user card on each side (px). */
export const BUBBLE_PAD_X = 12;
/** Vertical padding inside the card block stack on each side (px). */
export const BUBBLE_PAD_Y = 6;
/** Gap between consecutive blocks of different tiers (px). */
export const BLOCK_GAP = 10;
/** Tighter gap between two consecutive prose blocks (px). */
export const PROSE_GAP = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

const STACK_OPTS = { padY: BUBBLE_PAD_Y, blockGap: BLOCK_GAP, proseGap: PROSE_GAP };

/** Available width for block layout inside the user card. */
export function userInnerWidth(ctxWidth: number): number {
  return Math.max(1, ctxWidth - 2 * BUBBLE_PAD_X - 2 * USER_CARD_BORDER);
}

// ── Component ────────────────────────────────────────────────────────────────

export function UserMessageCard(props: { data: ChatMessage; ctx: RenderCtx }) {
  const mCtx = () => props.ctx.measureCtx?.();

  const innerWidth = () => {
    const c = mCtx();
    return c ? userInnerWidth(c.width) : 0;
  };

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) return null;
    const innerCtx = { ...ctx, width: innerWidth() };
    return layoutBlockStack(blocks, innerCtx, { ...STACK_OPTS, isCollapsed: ctx.isCollapsed });
  });

  /** Full unclipped content height including padding + borders. */
  const fullContentH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return USER_COLLAPSED_MAX_H;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) {
      return ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + 2 * USER_CARD_BORDER;
    }
    const innerCtx = { ...ctx, width: userInnerWidth(ctx.width) };
    const s = layoutBlockStack(blocks, innerCtx, { ...STACK_OPTS, isCollapsed: ctx.isCollapsed });
    return s.height + 2 * BUBBLE_PAD_Y + 2 * USER_CARD_BORDER;
  });

  const isExpanded = () => mCtx()?.expandedId === props.data.id;

  const maxH = () => (isExpanded() ? USER_EXPANDED_MAX_H : USER_COLLAPSED_MAX_H);

  const clampedH = () => Math.min(fullContentH(), maxH());

  const isOverflowing = () => fullContentH() > maxH();

  const plainText = () => {
    const ctx = mCtx();
    if (!ctx) return props.data.text;
    return ctx.caches.parseBlocks(props.data.id, props.data.text).map(blockPlainText).join('\n\n');
  };

  return (
    <div
      data-user-card={props.data.id}
      class={`text-chat-fg-body bg-chat-user-card border-chat-user-card-border relative rounded-lg border${!isExpanded() ? ' hover:border-chat-user-card-border-hover' : ''}`}
      style={{
        height: `${clampedH()}px`,
        'overflow-y': isExpanded() ? 'auto' : 'hidden',
        cursor: !isExpanded() && isOverflowing() ? 'pointer' : 'default',
        'padding-left': `${BUBBLE_PAD_X}px`,
        'padding-right': `${BUBBLE_PAD_X}px`,
        'padding-top': `${BUBBLE_PAD_Y}px`,
        'padding-bottom': `${BUBBLE_PAD_Y}px`,
        'box-sizing': 'border-box',
      }}
    >
      <div class="sr-only">{plainText()}</div>
      <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
    </div>
  );
}

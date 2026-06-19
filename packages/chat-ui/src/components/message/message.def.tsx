/**
 * messageUnitDef — native UnitDef for ChatMessage rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render lays out the block stack internally via BlockStackView.
 *
 * All message states map to exactly one unit (kind='message', key='self'):
 *   streaming   — block stack grows each tick; activeTurn bypasses segmentCache.
 *   empty       — fallback height = one line + padY overhead.
 *   finalized   — full block stack + optional copy-button footer (assistant).
 *
 * Chrome (role-specific visual treatment applied by UnitRow via GroupChrome):
 *   All roles share COMPOSITE_CHROME (insetX=ROW_INSET_X, no bg/border).
 *   Role differentiation (text color, italic for thought) is done inside Render.
 *
 * Padding:
 *   BUBBLE_PAD_Y is baked into layoutBlockStack's padY option.
 *   No bubble background or border — user messages are plain-padded rows.
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

// ── Layout constants (re-exported for PinnedUserMessage and tests) ───────────

/** Horizontal inset on each side for all message roles (px). Replaces per-role bubble padding. */
export const BUBBLE_PAD_X = 14;
/** Vertical padding inside the block stack on each side (px). */
export const BUBBLE_PAD_Y = 8;
/** Gap between consecutive blocks of different tiers in the block stack (px). */
export const BLOCK_GAP = 10;
/** Tighter gap between two consecutive prose blocks (px). */
export const PROSE_GAP = 4;
/** Reserved height for the assistant message footer (copy button row, px). */
export const MESSAGE_FOOTER_H = 24;

// ── Shared stack opts ────────────────────────────────────────────────────────

const STACK_OPTS = { padY: BUBBLE_PAD_Y, blockGap: BLOCK_GAP, proseGap: PROSE_GAP };

// ── measure ───────────────────────────────────────────────────────────────────

function measureMessage(item: ChatMessage, ctx: MeasureCtx): number {
  const blocks = ctx.caches.parseBlocks(item.id, item.text);
  const footer = item.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
  if (blocks.length === 0) {
    return ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + footer;
  }
  const stackMeasured = layoutBlockStack(blocks, ctx, {
    ...STACK_OPTS,
    isCollapsed: ctx.isCollapsed,
  });
  return stackMeasured.height + footer;
}

// ── Render ────────────────────────────────────────────────────────────────────

function MessageUnitRender(props: { data: ChatMessage; ctx: RenderCtx }) {
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

  const textClass = () => {
    if (props.data.role === 'thought') return 'text-chat-fg-muted italic';
    if (props.data.role === 'assistant') return 'text-chat-fg-body';
    return 'text-chat-fg-body';
  };

  const plainText = () => {
    const ctx = mCtx();
    if (!ctx) return props.data.text;
    return ctx.caches.parseBlocks(props.data.id, props.data.text).map(blockPlainText).join('\n\n');
  };

  return (
    <div class={textClass()} style={{ height: `${totalH()}px`, position: 'relative' }}>
      {/* a11y visually-hidden mirror */}
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

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const messageUnitDef = defineUnit<ChatMessage>({
  kind: 'message',
  estimate(item, ctx): number {
    const lines = Math.max(1, Math.ceil(item.text.length / 60));
    const footer = item.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
    return lines * ctx.theme.fonts.body.lineHeight + 2 * BUBBLE_PAD_Y + footer;
  },
  measure: measureMessage,
  Render: MessageUnitRender,
});

/**
 * messageDef — ComponentDef for ChatMessage rows.
 *
 * measure: builds a role-specific compose Measured tree and stores it in the
 *          layout payload so MessageRender can walk it via Project.
 *
 *   user:       bubble(blockStack, { padX, variantClass: bg+radius, width: hugWidth })
 *   assistant:  stack([ blockStack, slot('message:footer', MESSAGE_FOOTER_H) ])
 *   thought:    blockStack  (text color applied in the Render shell)
 *
 * MessageRender is a thin shell that applies flex alignment, the a11y mirror,
 * and the role-specific text color, then delegates entirely to Project.
 *
 * Per-block subtree memoization is handled by layoutBlockStack (block-stack.ts):
 * measureBlockCached (WeakMap by Block identity) makes streaming rows cheap —
 * only the last growing block re-measures each tick.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { blockPlainText } from '../../core/blocks/block-text';
import type { Block } from '../../core/blocks/block-types';
import { bubble, slot, stack } from '../../core/compose';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { USER_BUBBLE_MAX_WIDTH_PCT } from '../../core/metrics';
import type { ChatMessage, ChatRole } from '../../model';
import { useCaches } from '../CachesContext';
import { CopyButton } from '../primitives/CopyButton';
import { Project, renderBlockLeaf } from '../Project';
import { measureProseNaturalWidth } from '../prose/layout';

// ── Message layout constants ──────────────────────────────────────────────────

/** Horizontal padding inside the user message bubble on each side (px). */
export const BUBBLE_PAD_X = 14;
/** Vertical padding inside the message bubble block stack on each side (px). */
export const BUBBLE_PAD_Y = 8;
/** Gap between consecutive blocks of different tiers in the block stack (px). */
export const BLOCK_GAP = 10;
/** Tighter gap between two consecutive prose blocks (px). */
export const PROSE_GAP = 4;
/** Reserved height for the assistant message footer (copy button row, px). */
export const MESSAGE_FOOTER_H = 24;

// ── User-bubble hug width ─────────────────────────────────────────────────────

function userEffectiveWidth(blocks: Block[], contentWidth: number, ctx: MeasureCtx): number {
  const maxAllowed =
    Math.floor((contentWidth * USER_BUBBLE_MAX_WIDTH_PCT) / 100) - 2 * BUBBLE_PAD_X;

  let maxNatural = 0;
  for (const block of blocks) {
    if (ctx.isCollapsed(block.id)) continue;
    if (block.tier === 'prose') {
      maxNatural = Math.max(
        maxNatural,
        measureProseNaturalWidth(
          block,
          ctx.theme.fonts,
          ctx.caches.prepareRichInline.bind(ctx.caches)
        )
      );
    } else {
      return Math.max(1, maxAllowed);
    }
  }

  return Math.max(1, Math.min(Math.ceil(maxNatural) + 1, maxAllowed));
}

// ── Layout type ───────────────────────────────────────────────────────────────

export type MessageNodeLayout = {
  kind: 'message';
  /**
   * The role-specific compose subtree produced by measure().
   * Project walks this to render the message content.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- compose tree; type varies by role
  tree: Measured<any>;
};

// ── Role helpers ──────────────────────────────────────────────────────────────

function roleClass(role: ChatRole): string {
  if (role === 'user') return 'user';
  if (role === 'thought') return 'thought';
  return 'assistant';
}

// ── Render ────────────────────────────────────────────────────────────────────

function MessageRender(props: {
  item: ChatMessage;
  layout: Measured<MessageNodeLayout>;
  ctx: RenderCtx;
}) {
  const item = props.item;
  const caches = useCaches();
  const rc = () => roleClass(item.role);
  const blocks = () => caches.parseBlocks(item.id, item.text);

  const plainText = () => blocks().map(blockPlainText).join('\n\n');

  // Role-specific text color (Lane B — no layout impact).
  const textClass = () => {
    if (rc() === 'thought') return 'text-foreground-muted italic';
    if (rc() === 'assistant') return 'text-foreground-body';
    return ''; // user: text color is in the bubble variantClass
  };

  return (
    <div
      style={{ height: `${props.layout.height}px` }}
      class={`group flex flex-col ${rc() === 'user' ? 'items-end' : 'items-start'} ${textClass()}`}
    >
      {/* a11y visually-hidden mirror — sr-only is position:absolute, no height impact */}
      <div class="sr-only" aria-label={item.text}>
        {plainText()}
      </div>
      {/* Compose tree: Project walks the Measured tree for this role */}
      <Project
        node={props.layout.layout.tree}
        slots={{
          'message:footer': () => (
            <div
              class="flex items-center"
              style={{ height: `${MESSAGE_FOOTER_H}px` }}
              aria-hidden={item.streaming ? 'true' : undefined}
            >
              <Show when={!item.streaming}>
                <CopyButton text={item.text} variant="inline" label="Copy message" />
              </Show>
            </div>
          ),
        }}
      >
        {renderBlockLeaf}
      </Project>
    </div>
  );
}

// ── ComponentDef ──────────────────────────────────────────────────────────────

export const messageDef = defineComponent<ChatMessage, MessageNodeLayout>({
  kind: 'message',
  padY: 4,

  estimate(item, ctx: MeasureCtx): number {
    const lines = Math.ceil(item.text.length / 60);
    const lineH = ctx.theme.fonts.body.lineHeight;
    const footer = item.role === 'assistant' ? MESSAGE_FOOTER_H : 0;
    return lineH * Math.max(1, lines) + 2 * BUBBLE_PAD_Y + footer + 8;
  },

  measure(item, ctx: MeasureCtx): Measured<MessageNodeLayout> {
    const blocks = ctx.caches.parseBlocks(item.id, item.text);
    const isAssistant = item.role === 'assistant';

    const blockStackOpts = {
      padY: BUBBLE_PAD_Y,
      blockGap: BLOCK_GAP,
      proseGap: PROSE_GAP,
      isCollapsed: ctx.isCollapsed,
    };

    // ── Empty-blocks fallback ────────────────────────────────────────────────
    if (blocks.length === 0) {
      const emptyLineH = ctx.theme.fonts.body.lineHeight;
      const emptyH = emptyLineH + 2 * BUBBLE_PAD_Y + (isAssistant ? MESSAGE_FOOTER_H : 0);
      // An empty stack with the correct height so Project still renders a container.
      const emptyTree: Measured<{ kind: 'stack'; placed: [] }> = {
        height: emptyH,
        width: 0,
        layout: { kind: 'stack', placed: [] },
      };
      return { height: emptyH, width: 0, layout: { kind: 'message', tree: emptyTree } };
    }

    // ── User bubble ──────────────────────────────────────────────────────────
    if (item.role === 'user') {
      const hugWidth = userEffectiveWidth(blocks, ctx.width, ctx);
      const blockStack = layoutBlockStack(blocks, { ...ctx, width: hugWidth }, blockStackOpts);
      const bubbleWidth = hugWidth + 2 * BUBBLE_PAD_X;
      const tree = bubble(blockStack, {
        padX: BUBBLE_PAD_X,
        variantClass: 'bg-[var(--chat-bubble-user)] text-[var(--chat-bubble-user-fg)] rounded-lg',
        width: bubbleWidth,
      });
      return { height: tree.height, width: tree.width, layout: { kind: 'message', tree } };
    }

    // ── Assistant / thought ──────────────────────────────────────────────────
    const blockStack = layoutBlockStack(blocks, ctx, blockStackOpts);
    if (!isAssistant) {
      // thought: blockStack directly, text color applied in shell
      return {
        height: blockStack.height,
        width: blockStack.width,
        layout: { kind: 'message', tree: blockStack },
      };
    }

    // assistant: stack([ blockStack, footer slot ])
    const footerSlot = slot('message:footer', MESSAGE_FOOTER_H);
    const tree = stack(
      [
        { id: `${item.id}:blocks`, measured: blockStack },
        { id: `${item.id}:footer`, measured: footerSlot },
      ],
      { gap: 0 }
    );
    return { height: tree.height, width: tree.width, layout: { kind: 'message', tree } };
  },

  Render: MessageRender as Component<{
    item: ChatMessage;
    layout: Measured<MessageNodeLayout>;
    ctx: RenderCtx;
  }>,
});

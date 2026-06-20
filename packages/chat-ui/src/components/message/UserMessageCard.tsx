/**
 * UserMessageCard — the bordered, filled card used for user-role messages.
 *
 * Used by both:
 *   - messageUnitDef.Render (inline virtualized row) via message.def.tsx
 *   - PinnedUserMessage (sticky overlay)
 *
 * Geometry constants are the defaults; pass `vars` to override them from
 * `messageUnitDef.vars` so measure and render stay in sync.
 *
 * Expand state is driven by `ctx.measureCtx?.()?.expandedId === data.id`.
 * When collapsed (default) the card clips at `vars.collapsedMaxH` (120px).
 * When expanded the card shows up to `vars.expandedMaxH` (360px) with an
 * internal scrollbar. At most one card can be expanded at a time (enforced
 * by the single expandedUserId signal in ChatRoot).
 */

import { For, Show, createMemo } from 'solid-js';
import type { StackLayout } from '../../core/compose';
import type { Measured, RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { blockPlainText } from '../../core/markdown/plain-text';
import type { ChatMessage } from '../../model';
import { BlockStackView } from '../primitives/BlockStackView';
import { ImageOffIcon } from '../primitives/icons';

// ── MessageVars type ──────────────────────────────────────────────────────────

/** All geometry constants for user-message card layout. */
export type MessageVars = {
  /** Border width (px) on each side of the user card. */
  cardBorder: number;
  /** Max-height (px) of a collapsed user message card. */
  collapsedMaxH: number;
  /** Max-height (px) of an expanded user message card (with internal scroll). */
  expandedMaxH: number;
  /** Horizontal padding inside the user card on each side (px). */
  bubblePadX: number;
  /** Vertical padding inside the card block stack on each side (px). */
  bubblePadY: number;
  /** Gap between consecutive blocks of different tiers (px). */
  blockGap: number;
  /** Tighter gap between two consecutive prose blocks (px). */
  proseGap: number;
  /** Square thumbnail size (px) for an image attachment tile. */
  attachThumb: number;
  /** Gap (px) between attachment tiles and below the strip. */
  attachGap: number;
  /** Reserved height for the assistant message footer (copy button row, px). */
  footerH: number;
};

// ── Module-level defaults (kept for backward compat) ─────────────────────────

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

/** Available width for block layout inside the user card. */
export function userInnerWidth(ctxWidth: number, vars?: MessageVars): number {
  const padX = vars?.bubblePadX ?? BUBBLE_PAD_X;
  const border = vars?.cardBorder ?? USER_CARD_BORDER;
  return Math.max(1, ctxWidth - 2 * padX - 2 * border);
}

// ── Attachment strip geometry ─────────────────────────────────────────────────

/** Square thumbnail size (px) for an image attachment tile. */
export const ATTACH_THUMB = 32;
/** Gap (px) between attachment tiles and below the strip. */
export const ATTACH_GAP = 8;

/** Compute attachment strip height (private helper, mirrored by measureMessage). */
function attachStripH(count: number, innerW: number, thumb: number, gap: number): number {
  if (count <= 0) return 0;
  const perRow = Math.max(1, Math.floor((innerW + gap) / (thumb + gap)));
  const rows = Math.ceil(count / perRow);
  return rows * thumb + (rows - 1) * gap + gap; // + bottom gap
}

// ── Component ────────────────────────────────────────────────────────────────

export function UserMessageCard(props: { data: ChatMessage; ctx: RenderCtx; vars?: MessageVars }) {
  const v = () => props.vars;
  const mCtx = () => props.ctx.measureCtx?.();

  const padX = () => v()?.bubblePadX ?? BUBBLE_PAD_X;
  const padY = () => v()?.bubblePadY ?? BUBBLE_PAD_Y;
  const border = () => v()?.cardBorder ?? USER_CARD_BORDER;
  const thumb = () => v()?.attachThumb ?? ATTACH_THUMB;
  const gap = () => v()?.attachGap ?? ATTACH_GAP;
  const collapsedMaxH = () => v()?.collapsedMaxH ?? USER_COLLAPSED_MAX_H;
  const expandedMaxH = () => v()?.expandedMaxH ?? USER_EXPANDED_MAX_H;

  const innerWidth = () => {
    const c = mCtx();
    return c ? userInnerWidth(c.width, props.vars) : 0;
  };

  const stackOpts = () => ({
    padY: padY(),
    blockGap: v()?.blockGap ?? BLOCK_GAP,
    proseGap: v()?.proseGap ?? PROSE_GAP,
  });

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) return null;
    const innerCtx = { ...ctx, width: innerWidth() };
    return layoutBlockStack(blocks, innerCtx, { ...stackOpts(), isCollapsed: ctx.isCollapsed });
  });

  /** Full unclipped content height including padding + borders. */
  const fullContentH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return collapsedMaxH();
    const innerW = userInnerWidth(ctx.width, props.vars);
    const attachH = attachStripH(props.data.attachments?.length ?? 0, innerW, thumb(), gap());
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) {
      return attachH + ctx.theme.fonts.body.lineHeight + 2 * padY() + 2 * border();
    }
    const innerCtx = { ...ctx, width: innerW };
    const s = layoutBlockStack(blocks, innerCtx, {
      ...stackOpts(),
      isCollapsed: ctx.isCollapsed,
    });
    return attachH + s.height + 2 * padY() + 2 * border();
  });

  const isExpanded = () => mCtx()?.expandedId === props.data.id;

  const maxH = () => (isExpanded() ? expandedMaxH() : collapsedMaxH());

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
        'padding-left': `${padX()}px`,
        'padding-right': `${padX()}px`,
        'padding-top': `${padY()}px`,
        'padding-bottom': `${padY()}px`,
        'box-sizing': 'border-box',
      }}
    >
      <div class="sr-only">{plainText()}</div>
      {/* Image attachment thumbnail strip — mirrors the composer preview minus
          the remove button. Height reserved by the attachment strip arithmetic. */}
      <Show when={props.data.attachments?.length}>
        <div class="flex flex-wrap gap-2 pb-2">
          <For each={props.data.attachments}>
            {(att) => (
              <Show
                when={att.dataUrl}
                fallback={
                  <div
                    title={att.name}
                    class="ring-chat-border bg-chat-bg-2 text-chat-fg-muted grid size-8 place-items-center rounded-md ring-1"
                  >
                    <ImageOffIcon />
                  </div>
                }
              >
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  class="ring-chat-border size-8 rounded-md object-cover ring-1"
                />
              </Show>
            )}
          </For>
        </div>
      </Show>
      <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
      {/* Fade-out overlay shown only when the card is collapsed and content overflows. */}
      <Show when={!isExpanded() && isOverflowing()}>
        <div
          class="fade-overlay-bottom pointer-events-none absolute right-0 bottom-0 left-0 h-8 rounded-b-lg"
          style={{ '--fade-color': 'var(--chat-user-card-bg)' }}
        />
      </Show>
    </div>
  );
}

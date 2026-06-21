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
import { useCommands } from '../CommandsContext';
import { ImageOffIcon } from '../primitives/icons';
import {
  attachmentStrip,
  attachPlaceholder,
  attachThumb,
  attachThumbBtn,
  cardBase,
  cardFadeOverlay,
  cardHoverBorder,
  srOnly,
} from './user-message.css';

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
  const commands = useCommands();
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
      class={`${cardBase}${isOverflowing() && !isExpanded() ? ` ${cardHoverBorder}` : ''}`}
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
      <div class={srOnly}>{plainText()}</div>
      <Show when={props.data.attachments?.length}>
        <div class={attachmentStrip}>
          <For each={props.data.attachments}>
            {(att) => (
              <Show
                when={att.dataUrl}
                fallback={
                  <div title={att.name} class={attachPlaceholder}>
                    <ImageOffIcon />
                  </div>
                }
              >
                <button
                  type="button"
                  class={attachThumbBtn}
                  aria-label={`View image: ${att.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    commands().onViewImage?.({
                      attachment: att,
                      itemId: props.data.id,
                      source: 'user-message',
                    });
                  }}
                >
                  <img src={att.dataUrl} alt={att.name} class={attachThumb} />
                </button>
              </Show>
            )}
          </For>
        </div>
      </Show>
      <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
      <Show when={!isExpanded() && isOverflowing()}>
        <div
          class={cardFadeOverlay}
          style={{ '--fade-color': 'var(--chat-user-card-bg)' } as Record<string, string>}
        />
      </Show>
    </div>
  );
}

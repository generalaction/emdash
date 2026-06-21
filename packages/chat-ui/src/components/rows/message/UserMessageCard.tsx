import { assignInlineVars } from '@vanilla-extract/dynamic';
import { For, Show, createMemo } from 'solid-js';
import type { StackLayout } from '../../../core/compose';
import type { Measured, RenderCtx } from '../../../core/define';
import { layoutBlockStack } from '../../../core/layout/block-stack';
import { blockPlainText } from '../../../core/markdown/plain-text';
import type { ChatMessage } from '../../../model';
import { pxTokens } from '../../../styles/px-tokens';
import { useCommands } from '../../contexts/CommandsContext';
import { BlockStackView } from '../../primitives/BlockStackView';
import { ImageOffIcon } from '../../primitives/icons';
import { type MessageVars, userInnerWidth } from './metrics';
import {
  attachmentStrip,
  attachPlaceholder,
  attachThumb,
  attachThumbBtn,
  card,
  cardFadeOverlay,
  cardRoot,
  cardVars,
  srOnly,
} from './user-message.css';

function attachStripH(count: number, innerW: number, thumb: number, gap: number): number {
  if (count <= 0) return 0;
  const perRow = Math.max(1, Math.floor((innerW + gap) / (thumb + gap)));
  const rows = Math.ceil(count / perRow);
  return rows * thumb + (rows - 1) * gap + gap;
}

export function UserMessageCard(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  const commands = useCommands();
  const mCtx = () => props.ctx.measureCtx?.();

  const styleVars = () => ({
    height: clampedH(),
    userCardPadX: props.vars.userCardPadX,
    userCardPadY: props.vars.userCardPadY,
    cardBorder: props.vars.cardBorder,
    attachThumb: props.vars.attachThumb,
    attachGap: props.vars.attachGap,
  });

  const innerWidth = () => {
    const c = mCtx();
    return c ? userInnerWidth(c.width, props.vars) : 0;
  };

  const stackOpts = () => ({
    padY: props.vars.stackPadY,
    blockGap: mCtx()?.theme.density.blockGap ?? 10,
    proseGap: mCtx()?.theme.density.proseGap ?? 4,
  });

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) return null;
    const innerCtx = { ...ctx, width: innerWidth() };
    return layoutBlockStack(blocks, innerCtx, { ...stackOpts(), isCollapsed: ctx.isCollapsed });
  });

  const fullContentH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.vars.collapsedMaxH;
    const innerW = userInnerWidth(ctx.width, props.vars);
    const aH = attachStripH(
      props.data.attachments?.length ?? 0,
      innerW,
      props.vars.attachThumb,
      props.vars.attachGap
    );
    const blocks = ctx.caches.parseBlocks(props.data.id, props.data.text);
    if (blocks.length === 0) {
      return (
        aH +
        ctx.theme.fonts.body.lineHeight +
        2 * props.vars.userCardPadY +
        2 * props.vars.cardBorder
      );
    }
    const innerCtx = { ...ctx, width: innerW };
    const s = layoutBlockStack(blocks, innerCtx, {
      ...stackOpts(),
      isCollapsed: ctx.isCollapsed,
    });
    return aH + s.height + 2 * props.vars.userCardPadY + 2 * props.vars.cardBorder;
  });

  const isExpanded = () => mCtx()?.expandedId === props.data.id;
  const maxH = () => (isExpanded() ? props.vars.expandedMaxH : props.vars.collapsedMaxH);
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
      class={`${card({ state: isOverflowing() && !isExpanded() ? 'overflowing' : 'static' })} ${cardRoot}`}
      style={{
        ...assignInlineVars(cardVars, pxTokens(styleVars())),
        'overflow-y': isExpanded() ? 'auto' : 'hidden',
        cursor: !isExpanded() && isOverflowing() ? 'pointer' : 'default',
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

export { userInnerWidth };
export type { MessageVars };

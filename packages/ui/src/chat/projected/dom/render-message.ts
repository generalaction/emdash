/**
 * render-message — imperative DOM rendering for a ChatMessage row.
 *
 * Builds the .pmsg / .pmsg-bubble structure and dispatches each BlockLaidOut
 * to render-prose / render-code / render-island.
 * Also appends a .psr-only full-text mirror (a11y).
 *
 * Returns { node, dispose } where dispose() must be called before the row
 * is recycled (it tears down any island slot mounts).
 */

import type { Block, ProseBlock } from '../../blocks/block-types';
import { parseBlocksCached } from '../../blocks/parse-blocks';
import { BUBBLE_PAD_X, MESSAGE_GAP } from '../../metrics';
import type { ChatMessage } from '../../model';
import type { ViewStateStore } from '../../state/view-state-store';
import type { LayoutStore } from '../layout/layout-store';
import type { BlockLaidOut } from '../layout/layout-types';
import type { ImperativeSlots } from '../slots';
import { el } from './dom-utils';
import { renderCode } from './render-code';
import { renderIsland } from './render-island';
import { renderProse } from './render-prose';
import style from '../projected.module.css';

// ── Plain-text extractor for the a11y mirror ──────────────────────────────────

function blockPlainText(block: Block): string {
  if (block.tier === 'prose') {
    return (block as ProseBlock).runs
      .map((r) => ('text' in r ? r.text : 'label' in r ? r.label : ''))
      .join('');
  }
  if (block.tier === 'code') return block.code;
  return block.raw;
}

// ── Result type ───────────────────────────────────────────────────────────────

export type RenderMessageResult = {
  node: HTMLElement;
  /** Call before recycling the row to tear down island slot mounts. */
  dispose: () => void;
};

// ── Main function ─────────────────────────────────────────────────────────────

export function renderMessage(
  item: ChatMessage,
  layoutStore: LayoutStore,
  viewState: ViewStateStore,
  slots: ImperativeSlots | undefined,
  onHeightChange: () => void
): RenderMessageResult {
  const layout = layoutStore.getLayout(item, viewState);
  const blocks = parseBlocksCached(item.id, item.text);

  const isUser = item.role === 'user';
  const isThought = item.role === 'thought';
  const roleClass = isUser ? 'user' : isThought ? 'thought' : 'assistant';

  // ── a11y mirror (visually hidden, selectable for copy/find-in-page) ──────────
  const plainText = blocks.map(blockPlainText).join('\n\n');
  const mirror = el('div', {
    className: style['psr-only'],
    attrs: { 'aria-label': item.text },
    children: [plainText],
  });

  // ── Bubble (aria-hidden — content in mirror) ─────────────────────────────────
  // Padding is baked into the geometry (like the pretext demo), NOT CSS:
  //   - vertical: block `top` starts at BUBBLE_PAD_Y; layout.height includes
  //     2*BUBBLE_PAD_Y. The trailing MESSAGE_GAP is the inter-row gap and must
  //     NOT be drawn as part of the bubble, so we subtract it here.
  //   - horizontal: an inner content layer is inset by `contentInsetX`
  //     (BUBBLE_PAD_X for user bubbles, 0 for assistant/thought). CSS padding
  //     can't be used because the content is absolutely positioned.
  const bubbleHeight = layout.height - MESSAGE_GAP;
  const contentInsetX = isUser ? BUBBLE_PAD_X : 0;

  // User bubbles get an explicit width so the abs-positioned content (which has
  // no intrinsic width) doesn't collapse; assistant/thought keep width:100%.
  const bubbleStyle: Partial<CSSStyleDeclaration> = isUser
    ? {
        height: `${bubbleHeight}px`,
        width: `${layout.width + 2 * BUBBLE_PAD_X}px`,
        position: 'relative',
      }
    : { height: `${bubbleHeight}px`, position: 'relative' };

  const bubble = el('div', {
    className: `${style['pmsg-bubble']} ${style[`pmsg-bubble--${roleClass}`]}`,
    attrs: { 'aria-hidden': 'true' },
    style: bubbleStyle,
  });

  // Content layer: insets all blocks horizontally by contentInsetX.
  const content = el('div', {
    style: {
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: `${contentInsetX}px`,
      right: `${contentInsetX}px`,
    },
  });

  const disposers: Array<() => void> = [];

  for (const laidBlock of layout.blocks as BlockLaidOut[]) {
    if (laidBlock.height === 0) continue; // collapsed

    const rawBlock = blocks.find((b) => b.id === laidBlock.id);
    if (!rawBlock) continue;

    if (laidBlock.kind === 'prose') {
      const proseRaw = rawBlock as ProseBlock;
      const node = renderProse(laidBlock, proseRaw.runs, proseRaw.variant, slots);
      content.appendChild(node);
    } else if (laidBlock.kind === 'code') {
      const { node, dispose } = renderCode(laidBlock, rawBlock as Block & { tier: 'code' }, slots);
      content.appendChild(node);
      disposers.push(dispose);
    } else if (laidBlock.kind === 'island') {
      const { node, dispose } = renderIsland(
        laidBlock,
        rawBlock as Block & { tier: 'island' },
        slots,
        (blockId, height) => {
          layoutStore.setMeasured(blockId, height);
          onHeightChange();
        }
      );
      content.appendChild(node);
      disposers.push(dispose);
    }
  }

  // Streaming cursor
  if (item.streaming) {
    const cursor = el('span', {
      className: style['pchat-cursor'],
      attrs: { 'aria-hidden': 'true' },
      style: { position: 'absolute', bottom: '10px', left: '0' },
    });
    content.appendChild(cursor);
  }

  bubble.appendChild(content);

  // ── Outer row ────────────────────────────────────────────────────────────────
  const row = el('div', { className: `${style['pmsg']} ${style[`pmsg--${roleClass}`]}` });
  row.appendChild(mirror);
  row.appendChild(bubble);

  return {
    node: row,
    dispose: () => {
      for (const d of disposers) d();
    },
  };
}

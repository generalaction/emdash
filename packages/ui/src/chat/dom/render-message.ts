/**
 * render-message — imperative DOM rendering for a ChatMessage row.
 *
 * Builds the .pmsg / .pmsg-bubble structure and dispatches each BlockLaidOut
 * to render-prose / render-code / render-island.
 * Also appends a .psr-only full-text mirror (a11y).
 *
 * Returns { node, dispose } where dispose() must be called before the row
 * is recycled (it tears down any island slot mounts).
 *
 * For streaming messages, also returns `patchRefs` so the engine can call
 * `patchMessageContent` on each subsequent text chunk without remounting the
 * full row.
 */

import type { Block, ProseBlock } from '../blocks/block-types';
import { parseBlocksCached } from '../blocks/parse-blocks';
import { BUBBLE_PAD_X, MESSAGE_GAP } from '../metrics';
import type { ChatMessage, ChatRole } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import type { LayoutStore } from '../layout/layout-store';
import type { BlockLaidOut, MessageLayout } from '../layout/layout-types';
import type { ChatSlots } from '../slots';
import { el } from './dom-utils';
import { renderCode } from './render-code';
import { renderIsland } from './render-island';
import { renderProse } from './render-prose';
import style from './render-message.module.css';

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

// ── Result types ──────────────────────────────────────────────────────────────

export type RenderMessageResult = {
  node: HTMLElement;
  /** Call before recycling the row to tear down island slot mounts. */
  dispose: () => void;
  /**
   * Available only for streaming messages — refs for incremental DOM patching
   * via `patchMessageContent` on each subsequent text chunk.
   */
  patchRefs?: {
    bubbleEl: HTMLElement;
    contentEl: HTMLElement;
  };
};

export type PatchMessageResult = {
  /** New total row height (= newLayout.height) — caller must update the virtualizer. */
  newHeight: number;
  /** Disposers for any new island/code slot mounts — replace the old disposers. */
  disposers: Array<() => void>;
};

// ── Sub-element builders ──────────────────────────────────────────────────────

function MessageMirror(fullText: string, plainText: string): HTMLElement {
  return el('div', {
    className: style['psr-only'],
    attrs: { 'aria-label': fullText },
    children: [plainText],
  });
}

function MessageBubble(role: ChatRole, height: number, width?: number): HTMLElement {
  const isUser = role === 'user';
  const isThought = role === 'thought';
  const roleClass = isUser ? 'user' : isThought ? 'thought' : 'assistant';

  const bubbleStyle: Partial<CSSStyleDeclaration> = isUser
    ? { height: `${height}px`, width: `${width ?? 0}px`, position: 'relative' }
    : { height: `${height}px`, position: 'relative' };

  return el('div', {
    className: `${style['pmsg-bubble']} ${style[`pmsg-bubble--${roleClass}`]}`,
    attrs: { 'aria-hidden': 'true' },
    style: bubbleStyle,
  });
}

function MessageContentLayer(insetX: number): HTMLElement {
  return el('div', {
    style: {
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: `${insetX}px`,
      right: `${insetX}px`,
    },
  });
}

/**
 * Find the pixel position immediately after the last character of the last
 * prose block in the layout, so the cursor can be placed there.
 *
 * Returns `null` when the layout has no prose blocks (e.g. the message is
 * purely a code block), in which case the cursor falls back to the bottom
 * of the content area.
 */
function lastTextPosition(layout: MessageLayout): { top: number; left: number } | null {
  for (let i = layout.blocks.length - 1; i >= 0; i--) {
    const block = layout.blocks[i];
    if (block.kind === 'prose' && block.lines.length > 0) {
      const lastLine = block.lines[block.lines.length - 1];
      return {
        top: block.top + lastLine.top,
        left: lastLine.left + lastLine.endX,
      };
    }
  }
  return null;
}

function StreamingCursor(layout: MessageLayout): HTMLElement {
  const pos = lastTextPosition(layout);
  return el('span', {
    className: style['pchat-cursor'],
    attrs: { 'aria-hidden': 'true' },
    style: pos
      ? { position: 'absolute', top: `${pos.top}px`, left: `${pos.left}px` }
      : { position: 'absolute', bottom: '10px', left: '0' },
  });
}

// ── Shared content builder ────────────────────────────────────────────────────

/**
 * Fill `contentEl` with block DOM nodes.
 * Returns disposers for any island/code slot mounts.
 */
function buildContent(
  contentEl: HTMLElement,
  item: ChatMessage,
  layout: MessageLayout,
  slots: ChatSlots | undefined,
  onIslandHeightChange: (blockId: string, height: number) => void
): Array<() => void> {
  const blocks = parseBlocksCached(item.id, item.text);
  const disposers: Array<() => void> = [];

  for (const laidBlock of layout.blocks as BlockLaidOut[]) {
    if (laidBlock.height === 0) continue; // collapsed

    const rawBlock = blocks.find((b) => b.id === laidBlock.id);
    if (!rawBlock) continue;

    if (laidBlock.kind === 'prose') {
      const proseRaw = rawBlock as ProseBlock;
      const node = renderProse(laidBlock, proseRaw.runs, proseRaw.variant, slots);
      contentEl.appendChild(node);
    } else if (laidBlock.kind === 'code') {
      const { node, dispose } = renderCode(laidBlock, rawBlock as Block & { tier: 'code' }, slots);
      contentEl.appendChild(node);
      disposers.push(dispose);
    } else if (laidBlock.kind === 'island') {
      const { node, dispose } = renderIsland(
        laidBlock,
        rawBlock as Block & { tier: 'island' },
        slots,
        onIslandHeightChange
      );
      contentEl.appendChild(node);
      disposers.push(dispose);
    }
  }

  if (item.streaming) {
    contentEl.appendChild(StreamingCursor(layout));
  }

  return disposers;
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderMessage(
  item: ChatMessage,
  layoutStore: LayoutStore,
  viewState: ViewStateStore,
  slots: ChatSlots | undefined,
  onHeightChange: () => void
): RenderMessageResult {
  const layout = layoutStore.getLayout(item, viewState);

  const isUser = item.role === 'user';
  const isThought = item.role === 'thought';
  const roleClass = isUser ? 'user' : isThought ? 'thought' : 'assistant';

  // a11y mirror (visually hidden, selectable for copy/find-in-page)
  const blocks = parseBlocksCached(item.id, item.text);
  const plainText = blocks.map(blockPlainText).join('\n\n');
  const mirror = MessageMirror(item.text, plainText);

  // Padding is baked into the geometry (like the pretext demo), NOT CSS.
  // The trailing MESSAGE_GAP is the inter-row gap — not part of the bubble.
  const bubbleHeight = layout.height - MESSAGE_GAP;
  const contentInsetX = isUser ? BUBBLE_PAD_X : 0;

  const bubble = MessageBubble(
    item.role,
    bubbleHeight,
    isUser ? layout.width + 2 * BUBBLE_PAD_X : undefined
  );
  const content = MessageContentLayer(contentInsetX);

  const onIslandHeightChange = (blockId: string, height: number) => {
    layoutStore.setMeasured(blockId, height);
    onHeightChange();
  };

  const disposers = buildContent(content, item, layout, slots, onIslandHeightChange);

  bubble.appendChild(content);

  const row = el('div', { className: `${style['pmsg']} ${style[`pmsg--${roleClass}`]}` });
  row.appendChild(mirror);
  row.appendChild(bubble);

  return {
    node: row,
    dispose: () => {
      for (const d of disposers) d();
    },
    patchRefs: item.streaming ? { bubbleEl: bubble, contentEl: content } : undefined,
  };
}

// ── Incremental patch (streaming updates) ─────────────────────────────────────

/**
 * Incrementally update an already-mounted streaming message row.
 *
 * Clears and rebuilds only the content div (the bubble stays in place, so the
 * row doesn't visually flash).
 *
 * Caller is responsible for:
 *   - Calling the returned disposers' predecessors before calling this.
 *   - Updating `virt.setSize(i, result.newHeight)` and `canvas.style.height`.
 */
export function patchMessageContent(
  bubbleEl: HTMLElement,
  contentEl: HTMLElement,
  item: ChatMessage,
  layoutStore: LayoutStore,
  viewState: ViewStateStore,
  slots: ChatSlots | undefined,
  oldDisposers: Array<() => void>,
  onIslandHeightChange: (blockId: string, height: number) => void
): PatchMessageResult {
  // Run old island/code slot disposers before clearing the DOM.
  for (const d of oldDisposers) d();

  // Get fresh layout (caller must have invalidated cache before calling).
  const newLayout = layoutStore.getLayout(item, viewState);
  const isUser = item.role === 'user';

  // Clear content div.
  while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);

  // Rebuild with new layout.
  const newDisposers = buildContent(contentEl, item, newLayout, slots, onIslandHeightChange);

  // Update bubble dimensions.
  bubbleEl.style.height = `${newLayout.height - MESSAGE_GAP}px`;
  if (isUser) {
    bubbleEl.style.width = `${newLayout.width + 2 * BUBBLE_PAD_X}px`;
  }

  return { newHeight: newLayout.height, disposers: newDisposers };
}

/**
 * PinnedUserMessage — a non-virtualized copy of a user message row, rendered
 * as the pinned-header overlay in ChatRoot when `pinUserMessages` is enabled.
 *
 * Mirrors the geometry of a message unit rendered by UnitRow:
 *   chrome = COMPOSITE_CHROME (insetX=ROW_INSET_X, no bg/border/padY)
 *   inner padding comes from layoutBlockStack's padY (BUBBLE_PAD_Y each side)
 *
 * Rendered as a `bg-chat-bg/80 backdrop-blur-sm` container with ROW_GAP top
 * padding so the message sits 8px below the viewport top while the strip above
 * hides rows scrolling behind it.
 *
 * Does NOT call `virt.setSize` — the overlay is outside the virtualizer tree.
 */

import { For, Show } from 'solid-js';
import type { ChatCaches } from '../core/caches';
import type { MeasureCtx } from '../core/define';
import { measureBlockCached } from '../core/layout/block-stack';
import type { CodeLeafLayout, ProseLeafLayout, TableLeafLayout } from '../core/layout/layout-types';
import type { Block } from '../core/markdown/document';
import { ROW_GAP, ROW_INSET_X } from '../core/metrics';
import type { ChatTheme } from '../core/theme';
import type { ChatMessage } from '../model';
import { Code } from './code/Code';
import { Prose } from './prose/Prose';
import { Table } from './table/Table';

function BlockRender(props: { block: Block; mCtx: MeasureCtx }) {
  const laid = () => measureBlockCached(props.block, props.mCtx);
  return (
    <Show when={laid()}>
      {(l) => {
        const layout = l().layout;
        if (layout.kind === 'prose') {
          const pl = layout as ProseLeafLayout;
          return <Prose block={pl} runs={pl.raw.runs} variant={pl.raw.variant} />;
        }
        if (layout.kind === 'code') {
          const cl = layout as CodeLeafLayout;
          return <Code block={cl} rawBlock={cl.raw} />;
        }
        if (layout.kind === 'table') {
          const tl = layout as TableLeafLayout;
          return <Table block={tl} />;
        }
        return null;
      }}
    </Show>
  );
}

export function PinnedUserMessage(props: {
  item: ChatMessage;
  rowWidth: number;
  theme: ChatTheme;
  caches: ChatCaches;
}) {
  const innerWidth = () => Math.max(1, props.rowWidth - 2 * ROW_INSET_X);

  const mCtx = (): MeasureCtx => ({
    theme: props.theme,
    width: innerWidth(),
    isCollapsed: () => false,
    expanded: () => false,
    caches: props.caches,
  });

  const blocks = () => props.caches.parseBlocks(props.item.id, props.item.text);

  return (
    <>
      <div
        class="bg-chat-bg/80 backdrop-blur-sm"
        style={{
          'padding-top': `${ROW_GAP}px`,
          'padding-left': `${ROW_INSET_X}px`,
          'padding-right': `${ROW_INSET_X}px`,
        }}
      >
        <div class="text-chat-fg-body">
          <For each={blocks()}>{(block) => <BlockRender block={block} mCtx={mCtx()} />}</For>
        </div>
      </div>
      {/* 16px scroll fade: signals that rows scroll beneath the pinned message. */}
      <div class="fade-overlay-top h-4" aria-hidden="true" />
    </>
  );
}

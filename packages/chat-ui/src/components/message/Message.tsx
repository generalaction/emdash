/**
 * Message — Solid component rendering a ChatMessage row.
 *
 * Uses pre-computed MessageLayout to absolutely-position blocks. Prose lines
 * are rendered via keyed <For> so Solid re-renders only changed lines during
 * streaming. Islands write back their measured height to the parent via
 * onIslandMeasured.
 */

import { For, Show } from 'solid-js';
import type { ProseBlock } from '../../core/blocks/block-types';
import { parseBlocksCached } from '../../core/blocks/parse-blocks';
import type {
  BlockLaidOut,
  CodeLaidOut,
  IslandLaidOut,
  MessageLayout,
  ProseLaidOut,
  TableLaidOut,
} from '../../core/layout/layout-types';
import { ROW_GAP } from '../../core/metrics';
import type { ChatMessage, ChatRole } from '../../model';
import { Code } from '../code/Code';
import { Island } from '../island/Island';
import { Prose } from '../prose/Prose';
import { Table } from '../table/Table';
import { BUBBLE_PAD_X } from './metrics';
import styles from './message.module.css';

export type MessageProps = {
  item: ChatMessage;
  layout: MessageLayout;
  onIslandMeasured?: (blockId: string, height: number) => void;
};

// ── Plain-text extractor (a11y) ───────────────────────────────────────────────

function blockPlainText(block: {
  tier: string;
  runs?: Array<{ text?: string; label?: string }>;
  code?: string;
  raw?: string;
  header?: string[];
  rows?: string[][];
}): string {
  if (block.tier === 'prose') {
    return (block.runs ?? []).map((r) => r.text ?? r.label ?? '').join('');
  }
  if (block.tier === 'code') return block.code ?? '';
  if (block.tier === 'table') {
    const allRows = [block.header ?? [], ...(block.rows ?? [])];
    return allRows.map((row) => row.join(' | ')).join('\n');
  }
  return block.raw ?? '';
}

// ── Streaming cursor ──────────────────────────────────────────────────────────

function lastTextPosition(layout: MessageLayout): { top: number; left: number } | null {
  for (let i = layout.blocks.length - 1; i >= 0; i--) {
    const block = layout.blocks[i];
    if (block.kind === 'prose' && (block as ProseLaidOut).lines.length > 0) {
      const b = block as ProseLaidOut;
      const lastLine = b.lines[b.lines.length - 1];
      return { top: block.top + lastLine.top, left: lastLine.left + lastLine.endX };
    }
  }
  return null;
}

function StreamingCursor(props: { layout: MessageLayout }) {
  const pos = lastTextPosition(props.layout);
  return (
    <span
      class={styles['pchat-cursor']}
      aria-hidden="true"
      style={
        pos
          ? { position: 'absolute', top: `${pos.top}px`, left: `${pos.left}px` }
          : { position: 'absolute', bottom: '10px', left: '0' }
      }
    />
  );
}

// ── Role helpers ──────────────────────────────────────────────────────────────

function roleClass(role: ChatRole): string {
  if (role === 'user') return 'user';
  if (role === 'thought') return 'thought';
  return 'assistant';
}

// ── Main component ────────────────────────────────────────────────────────────

export function Message(props: MessageProps) {
  const isUser = () => props.item.role === 'user';
  const rc = () => roleClass(props.item.role);
  const blocks = () => parseBlocksCached(props.item.id, props.item.text);
  const bubbleHeight = () => props.layout.height - ROW_GAP;
  const bubbleWidth = () => (isUser() ? props.layout.width + 2 * BUBBLE_PAD_X : undefined);
  const contentInsetX = () => (isUser() ? BUBBLE_PAD_X : 0);

  // a11y full-text mirror
  const plainText = () =>
    blocks()
      .map((b) => blockPlainText(b as unknown as Parameters<typeof blockPlainText>[0]))
      .join('\n\n');

  const renderBlock = (laidBlock: BlockLaidOut) => {
    if (laidBlock.height === 0) return null;
    const rawBlock = blocks().find((b) => b.id === laidBlock.id);
    if (!rawBlock) return null;

    if (laidBlock.kind === 'prose') {
      const pb = rawBlock as ProseBlock;
      return <Prose block={laidBlock as ProseLaidOut} runs={pb.runs} variant={pb.variant} />;
    }
    if (laidBlock.kind === 'code') {
      return (
        <Code
          block={laidBlock as CodeLaidOut}
          rawBlock={rawBlock as import('../../core/blocks/block-types').CodeBlock}
        />
      );
    }
    if (laidBlock.kind === 'table') {
      return <Table block={laidBlock as TableLaidOut} />;
    }
    return <Island block={laidBlock as IslandLaidOut} onMeasured={props.onIslandMeasured} />;
  };

  // Bubble visual class — user bubble gets a colored bg + radius; thought is muted+italic
  const bubbleVisualClass = () => {
    if (rc() === 'user')
      return 'bg-[var(--chat-bubble-user,#2563eb)] text-[var(--chat-bubble-user-fg,#fff)] rounded-[16px]';
    if (rc() === 'thought') return 'text-foreground-muted italic';
    return '';
  };

  return (
    <div
      class={`flex px-[var(--chat-msg-pad-x)] ${rc() === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {/* a11y visually-hidden mirror */}
      <div class="sr-only" aria-label={props.item.text}>
        {plainText()}
      </div>
      {/* Visible bubble */}
      <div
        class={`${styles['pmsg-bubble']} ${bubbleVisualClass()}`}
        aria-hidden="true"
        style={{
          height: `${bubbleHeight()}px`,
          ...(isUser() ? { width: `${bubbleWidth()}px` } : { width: '100%' }),
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '0',
            bottom: '0',
            left: `${contentInsetX()}px`,
            right: `${contentInsetX()}px`,
          }}
        >
          <For each={props.layout.blocks}>{(laidBlock) => renderBlock(laidBlock)}</For>
          <Show when={props.item.streaming}>
            <StreamingCursor layout={props.layout} />
          </Show>
        </div>
      </div>
    </div>
  );
}

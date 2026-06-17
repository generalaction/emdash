/**
 * Message — Solid component rendering a ChatMessage row.
 *
 * Uses pre-computed MessageLayout to absolutely-position blocks. Prose lines
 * are rendered via keyed <For> so Solid re-renders only changed lines during
 * streaming. Islands write back their measured height to the parent via
 * onIslandMeasured.
 *
 * Assistant messages include a reserved footer (MESSAGE_FOOTER_H) below the
 * bubble that shows a hover-revealed Copy button.
 */

import { Show, createSignal, onCleanup } from 'solid-js';
import { parseBlocksCached } from '../../core/blocks/parse-blocks';
import type { MessageLayout } from '../../core/layout/layout-types';
import type { ChatMessage, ChatRole } from '../../model';
import { BlockStack } from '../rich-text/BlockStack';
import { BUBBLE_PAD_X, MESSAGE_FOOTER_H } from './metrics';
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

// ── Role helpers ──────────────────────────────────────────────────────────────

function roleClass(role: ChatRole): string {
  if (role === 'user') return 'user';
  if (role === 'thought') return 'thought';
  return 'assistant';
}

// ── Copy icons ────────────────────────────────────────────────────────────────

function IconCopy() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,8 6,12 14,4" />
    </svg>
  );
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton(props: { text: string }) {
  const [copied, setCopied] = createSignal(false);

  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleClick = () => {
    void navigator.clipboard.writeText(props.text).then(() => {
      setCopied(true);
      resetTimer = setTimeout(() => {
        setCopied(false);
        resetTimer = undefined;
      }, 1500);
    });
  };

  onCleanup(() => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
  });

  return (
    <button
      type="button"
      class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center gap-1 text-foreground-passive hover:text-foreground cursor-pointer select-none text-xs"
      aria-label={copied() ? 'Copied' : 'Copy message'}
      onClick={handleClick}
    >
      <Show when={copied()} fallback={<IconCopy />}>
        <IconCheck />
      </Show>
      <span>{copied() ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Message(props: MessageProps) {
  const isUser = () => props.item.role === 'user';
  const isAssistant = () => props.item.role === 'assistant';
  const rc = () => roleClass(props.item.role);
  const blocks = () => parseBlocksCached(props.item.id, props.item.text);

  // Reserve footer space for assistant; bubble uses the remaining height.
  const footer = () => (isAssistant() ? MESSAGE_FOOTER_H : 0);
  const bubbleHeight = () => props.layout.height - footer();
  const bubbleWidth = () => (isUser() ? props.layout.width + 2 * BUBBLE_PAD_X : undefined);
  const contentInsetX = () => (isUser() ? BUBBLE_PAD_X : 0);

  // a11y full-text mirror
  const plainText = () =>
    blocks()
      .map((b) => blockPlainText(b as unknown as Parameters<typeof blockPlainText>[0]))
      .join('\n\n');

  // Bubble visual class — user bubble gets a colored bg + radius; thought is muted+italic
  const bubbleVisualClass = () => {
    if (rc() === 'user')
      return 'bg-[var(--chat-bubble-user)] text-[var(--chat-bubble-user-fg)] rounded-lg';
    if (rc() === 'thought') return 'text-foreground-muted italic';
    return '';
  };

  return (
    <div
      class={`group flex flex-col px-[var(--chat-msg-pad-x)] ${rc() === 'user' ? 'items-end' : 'items-start'}`}
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
          <BlockStack
            blocks={blocks()}
            laid={props.layout.blocks}
            onIslandMeasured={props.onIslandMeasured}
          />
        </div>
      </div>
      {/* Actions footer — reserved height, copy button visible on hover */}
      <Show when={isAssistant()}>
        <div
          class="flex items-center"
          style={{ height: `${MESSAGE_FOOTER_H}px` }}
          aria-hidden={props.item.streaming ? 'true' : undefined}
        >
          <Show when={!props.item.streaming}>
            <CopyButton text={props.item.text} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

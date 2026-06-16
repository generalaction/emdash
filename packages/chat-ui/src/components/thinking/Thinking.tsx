/**
 * Thinking — SolidJS component for ChatThinking rows.
 *
 * Both states are always collapsible/expandable via ThinkingHeader.
 *
 * Collapse semantics are inverted for thinking rows:
 *   stored false (default) → not expanded
 *     active: shows fixed-height preview window (ActivePreview)
 *     done:   shows header only
 *   stored true → expanded
 *     both: shows full prose body (ExpandedBody) laid out via pretext
 *
 * The existing click-delegation in ChatRoot (data-collapse-id → toggleCollapsed)
 * drives the toggle without any ChatRoot or view-state changes.
 *
 * Geometry-coupled rules (heights, insets) live in thinking.module.css.
 * All visual styling uses Tailwind utilities.
 */

import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import {
  downgradeIslandsToText,
  flattenHeadings,
  parseBlocksCached,
} from '../../core/blocks/parse-blocks';
import type { ChatThinking } from '../../model';
import { BlockStack } from '../rich-text/BlockStack';
import type { BlocksLayout } from '../rich-text/layout';
import { THINKING_HEADER_H, THINKING_WINDOW_H } from './metrics';
import styles from './thinking.module.css';

export type ThinkingProps = {
  item: ChatThinking;
  /** Stores "expanded" state — inverted from the conventional "collapsed" name. */
  collapsed?: boolean;
  /** Pre-computed pretext body layout (present only when expanded). */
  body?: BlocksLayout;
};

function formatDurationS(ms: number): string {
  return String(Math.floor(ms / 1000));
}

// ── ThinkingHeader ─────────────────────────────────────────────────────────────

function ThinkingHeader(props: { item: ChatThinking; expanded: boolean }) {
  const startElapsed = Math.floor((Date.now() - props.item.startedAt) / 1000);
  const [elapsed, setElapsed] = createSignal(startElapsed);

  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (props.item.status === 'thinking') {
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - props.item.startedAt) / 1000));
      }, 1000);
    } else {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => clearInterval(timer));

  const label = () => {
    if (props.item.status === 'thinking') return `Thinking ${elapsed()}s`;
    const durationS =
      props.item.durationMs !== undefined ? formatDurationS(props.item.durationMs) : '?';
    return `Thought for ${durationS}s`;
  };

  return (
    <div
      class={`${styles['pthinking__header']} flex cursor-pointer items-center gap-1.5 text-xs text-foreground-muted select-none hover:text-foreground`}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      aria-live={props.item.status === 'thinking' ? 'polite' : undefined}
      aria-atomic={props.item.status === 'thinking' ? 'false' : undefined}
      data-collapse-id={props.item.id}
    >
      <span classList={{ 'text-shimmer': props.item.status === 'thinking' }}>{label()}</span>
      <span
        class="inline-block text-[10px] transition-transform duration-150 ease-out"
        classList={{ 'rotate-90': props.expanded }}
        aria-hidden="true"
      >
        ›
      </span>
    </div>
  );
}

// ── ActivePreview ──────────────────────────────────────────────────────────────

function ActivePreview(props: { item: ChatThinking }) {
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    // Reading props.item.text registers this effect as a reactive subscriber
    // so it re-runs on every streaming update to pin the scroll to bottom.
    if (props.item.text != null && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  return (
    <div class={`${styles['pthinking__window']} relative overflow-hidden`}>
      <div
        class="fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10 h-[var(--chat-think-fade-h)]"
        aria-hidden="true"
      />
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        class={`${styles['pthinking__window-scroll']} overflow-y-auto text-xs wrap-break-word whitespace-pre-wrap text-foreground-muted`}
      >
        {props.item.text}
      </div>
    </div>
  );
}

// ── ExpandedBody ───────────────────────────────────────────────────────────────

function ExpandedBody(props: { item: ChatThinking; body: BlocksLayout }) {
  const blocks = () =>
    downgradeIslandsToText(
      flattenHeadings(parseBlocksCached(props.item.id, props.item.text ?? ''))
    );
  return (
    <div class={styles['pthinking__body']} style={{ height: `${props.body.height}px` }}>
      <BlockStack blocks={blocks()} laid={props.body.blocks} />
    </div>
  );
}

// ── ThinkingContent ────────────────────────────────────────────────────────────

function ThinkingContent(props: { item: ChatThinking; expanded: boolean; body?: BlocksLayout }) {
  return (
    <Show
      when={props.expanded && props.body}
      fallback={
        <Show when={props.item.status === 'thinking'}>
          <ActivePreview item={props.item} />
        </Show>
      }
    >
      {(body) => <ExpandedBody item={props.item} body={body()} />}
    </Show>
  );
}

// ── Thinking ───────────────────────────────────────────────────────────────────

export function Thinking(props: ThinkingProps) {
  // Inverted semantics: stored "collapsed" flag is treated as "expanded".
  // Default absent/false → not expanded → preview (active) or header-only (done).
  const expanded = () => !!props.collapsed;

  const totalH = () => {
    if (props.body) return THINKING_HEADER_H + props.body.height;
    if (props.item.status === 'thinking') return THINKING_HEADER_H + THINKING_WINDOW_H;
    return THINKING_HEADER_H;
  };

  return (
    <div class={styles.pthinking} style={{ position: 'relative', height: `${totalH()}px` }}>
      <ThinkingHeader item={props.item} expanded={expanded()} />
      <ThinkingContent item={props.item} expanded={expanded()} body={props.body} />
    </div>
  );
}

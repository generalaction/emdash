/**
 * Thinking — Solid component for ChatThinking rows.
 *
 * Two states:
 *   active (status === 'thinking'): spinner + "Thinking Xs" + streaming window
 *   done (status === 'done'):       "Thought for Xs >" header + collapsible body
 *
 * Visual styles use Tailwind utilities. Geometry-coupled rules (header/window
 * heights, body padding-block, spinner size, mask-image, keyframes) remain in
 * thinking.module.css because the layout engine's arithmetic depends on them.
 */

import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { ChatThinking } from '../../model';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';
import styles from './thinking.module.css';

export type ThinkingProps = {
  item: ChatThinking;
  collapsed?: boolean;
  onBodyMeasured?: (id: string, height: number) => void;
};

function formatDurationS(ms: number): string {
  return String(Math.floor(ms / 1000));
}

// ── Active state ──────────────────────────────────────────────────────────────

function ThinkingActive(props: { item: ChatThinking }) {
  const startElapsed = Math.floor((Date.now() - props.item.startedAt) / 1000);
  const [elapsed, setElapsed] = createSignal(startElapsed);

  const timer = setInterval(() => {
    setElapsed(Math.floor((Date.now() - props.item.startedAt) / 1000));
  }, 1000);
  onCleanup(() => clearInterval(timer));

  return (
    <div
      class={styles.pthinking}
      style={{ position: 'relative', height: `${THINKING_HEADER_H + THINKING_WINDOW_H}px` }}
    >
      <div
        class={`${styles['pthinking__header']} flex items-center gap-1.5 text-xs text-foreground-muted`}
        aria-live="polite"
        aria-atomic="false"
      >
        <span class={styles['pthinking__spinner']} />
        <span>Thinking {elapsed()}s</span>
      </div>
      <div class={styles['pthinking__window']}>
        <div class={`${styles['pthinking__window-text']} text-foreground-muted`}>
          {props.item.text}
        </div>
      </div>
    </div>
  );
}

// ── Done state ────────────────────────────────────────────────────────────────

function ThinkingDone(props: ThinkingProps & { bodyMeasuredHeight?: number }) {
  const durationS =
    props.item.durationMs !== undefined ? formatDurationS(props.item.durationMs) : '?';
  const expanded = () => !props.collapsed;

  let bodyEl: HTMLDivElement | undefined;

  onMount(() => {
    if (!expanded() || !props.onBodyMeasured) return;
    requestAnimationFrame(() => {
      const h = bodyEl?.getBoundingClientRect().height ?? 0;
      if (h > 0) props.onBodyMeasured!(props.item.id, h);
    });
  });

  const totalH = () => {
    if (props.collapsed) return THINKING_HEADER_H;
    return THINKING_HEADER_H + 2 * THINKING_PAD_Y + (props.bodyMeasuredHeight ?? THINKING_WINDOW_H);
  };

  return (
    <div class={styles.pthinking} style={{ position: 'relative', height: `${totalH()}px` }}>
      <div
        class={`${styles['pthinking__header']} flex items-center gap-1.5 cursor-pointer select-none text-xs text-foreground-muted hover:text-foreground`}
        role="button"
        aria-expanded={expanded() ? 'true' : 'false'}
        data-collapse-id={props.item.id}
      >
        Thought for {durationS}s
        <span
          class={`${styles['pthinking__chevron']}${expanded() ? ` ${styles['pthinking__chevron--expanded']}` : ''} text-foreground-muted`}
          aria-hidden="true"
        >
          ›
        </span>
      </div>
      <Show when={expanded()}>
        <div
          ref={(el) => {
            bodyEl = el;
          }}
          class={`${styles['pthinking__body']} border-t border-border text-foreground-muted`}
          style={{ top: `${THINKING_HEADER_H}px` }}
        >
          {props.item.text}
        </div>
      </Show>
    </div>
  );
}

export function Thinking(props: ThinkingProps & { bodyMeasuredHeight?: number }) {
  return (
    <Show when={props.item.status === 'done'} fallback={<ThinkingActive item={props.item} />}>
      <ThinkingDone
        item={props.item}
        collapsed={props.collapsed}
        onBodyMeasured={props.onBodyMeasured}
        bodyMeasuredHeight={props.bodyMeasuredHeight}
      />
    </Show>
  );
}

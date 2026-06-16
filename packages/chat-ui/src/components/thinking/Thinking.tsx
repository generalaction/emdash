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
 *     both: shows full pre-wrap prose body (ExpandedBody)
 *
 * The existing click-delegation in ChatRoot (data-collapse-id → toggleCollapsed)
 * drives the toggle without any ChatRoot or view-state changes.
 *
 * Geometry-coupled rules (heights, insets, padding-block) live in
 * thinking.module.css. All visual styling uses Tailwind utilities.
 */

import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { ChatThinking } from '../../model';
import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';
import styles from './thinking.module.css';

export type ThinkingProps = {
  item: ChatThinking;
  /** Stores "expanded" state — inverted from the conventional "collapsed" name. */
  collapsed?: boolean;
  onBodyMeasured?: (id: string, height: number) => void;
  bodyMeasuredHeight?: number;
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
      <span>{label()}</span>
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
        class={`${styles['pthinking__window-fade']} pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-background to-transparent`}
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

function ExpandedBody(props: {
  item: ChatThinking;
  onBodyMeasured?: (id: string, h: number) => void;
}) {
  let bodyEl: HTMLDivElement | undefined;

  onMount(() => {
    if (!props.onBodyMeasured || !bodyEl) return;
    const report = () => {
      const h = bodyEl?.getBoundingClientRect().height ?? 0;
      if (h > 0) props.onBodyMeasured!(props.item.id, h);
    };
    const ro = new ResizeObserver(report);
    ro.observe(bodyEl);
    onCleanup(() => ro.disconnect());
    report();
  });

  return (
    <div
      ref={(el) => {
        bodyEl = el;
      }}
      class={`${styles['pthinking__body']} overflow-auto text-xs wrap-break-word whitespace-pre-wrap text-foreground-muted`}
    >
      {props.item.text}
    </div>
  );
}

// ── ThinkingContent ────────────────────────────────────────────────────────────

function ThinkingContent(props: {
  item: ChatThinking;
  expanded: boolean;
  onBodyMeasured?: (id: string, h: number) => void;
}) {
  return (
    <Show
      when={props.expanded}
      fallback={
        <Show when={props.item.status === 'thinking'}>
          <ActivePreview item={props.item} />
        </Show>
      }
    >
      <ExpandedBody item={props.item} onBodyMeasured={props.onBodyMeasured} />
    </Show>
  );
}

// ── Thinking ───────────────────────────────────────────────────────────────────

export function Thinking(props: ThinkingProps) {
  // Inverted semantics: stored "collapsed" flag is treated as "expanded".
  // Default absent/false → not expanded → preview (active) or header-only (done).
  const expanded = () => !!props.collapsed;

  const totalH = () => {
    if (!expanded()) {
      if (props.item.status === 'thinking') return THINKING_HEADER_H + THINKING_WINDOW_H;
      return THINKING_HEADER_H;
    }
    return THINKING_HEADER_H + 2 * THINKING_PAD_Y + (props.bodyMeasuredHeight ?? THINKING_WINDOW_H);
  };

  return (
    <div class={styles.pthinking} style={{ position: 'relative', height: `${totalH()}px` }}>
      <ThinkingHeader item={props.item} expanded={expanded()} />
      <ThinkingContent
        item={props.item}
        expanded={expanded()}
        onBodyMeasured={props.onBodyMeasured}
      />
    </div>
  );
}

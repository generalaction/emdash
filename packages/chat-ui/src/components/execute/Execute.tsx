/**
 * Execute — SolidJS component for ChatExecute rows.
 *
 * Renders ACP `kind: 'execute'` tool calls (e.g. Bash commands).
 *
 * Header: "Execute {command} {elapsed}s ›"
 *   - Shimmer while running.
 *   - Live ticking elapsed counter while running; frozen duration when done.
 *   - Clicking the whole header toggles collapsed/expanded via data-collapse-id
 *     delegation in ChatRoot (no ChatRoot changes needed).
 *
 * Collapsed (default): header only.
 * Expanded: header + scrollable, max-height monospace output body.
 *
 * Collapse semantics are inverted (same as FileOperation / Thinking):
 *   stored false (default) → not expanded
 *   stored true            → expanded
 *
 * Geometry-coupled rules live in execute.module.css.
 * All visual styling uses Tailwind utilities.
 */

import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { ChatExecute } from '../../model';
import { EXEC_PAD_Y } from './metrics';
import styles from './execute.module.css';

export type ExecuteProps = {
  item: ChatExecute;
  /** Inverted semantics: stored "collapsed" bool means "expanded". */
  collapsed?: boolean;
};

// ── ExecuteHeader ─────────────────────────────────────────────────────────────

function ExecuteHeader(props: { item: ChatExecute; expanded: boolean }) {
  const startElapsed = Math.floor((Date.now() - props.item.startedAt) / 1000);
  const [elapsed, setElapsed] = createSignal(startElapsed);

  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (props.item.status === 'running') {
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - props.item.startedAt) / 1000));
      }, 1000);
    } else {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => clearInterval(timer));

  const durationS = () => {
    if (props.item.durationMs !== undefined) return Math.floor(props.item.durationMs / 1000);
    return elapsed();
  };

  const command = () => props.item.command || '…';

  return (
    <div
      class={`${styles['pexec__header']} flex cursor-pointer items-center gap-1.5 select-none hover:text-foreground`}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.item.id}
    >
      <span
        class="text-xs text-foreground-muted"
        classList={{ 'text-shimmer': props.item.status === 'running' }}
      >
        Execute {command()} {durationS()}s
      </span>
      <span
        class="inline-block text-[10px] text-foreground-muted transition-transform duration-150 ease-out"
        classList={{ 'rotate-90': props.expanded }}
        aria-hidden="true"
      >
        ›
      </span>
    </div>
  );
}

// ── ExecuteBody ───────────────────────────────────────────────────────────────

function ExecuteBody(props: { output: string }) {
  return (
    <div class={styles['pexec__body']}>
      <div style={{ 'padding-block': `${EXEC_PAD_Y}px` }}>
        <div class={`${styles['pexec__scroll']} text-xs text-foreground-muted`}>
          {props.output}
        </div>
      </div>
    </div>
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export function Execute(props: ExecuteProps) {
  // Inverted semantics: stored "collapsed" flag is treated as "expanded".
  const expanded = () => !!props.collapsed;

  return (
    <div class={styles.pexec} style={{ position: 'relative' }}>
      <ExecuteHeader item={props.item} expanded={expanded()} />
      <Show when={expanded() && props.item.output}>
        {(output) => <ExecuteBody output={output()} />}
      </Show>
    </div>
  );
}

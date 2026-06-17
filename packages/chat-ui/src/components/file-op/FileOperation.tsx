/**
 * FileOperation — SolidJS component for ChatFileOpToolCall rows.
 *
 * Renders ACP file-operation tool calls (read / edit / delete / move).
 *
 * Single file (ops.length <= 1):
 *   Inline one-liner, e.g. "Read foo.tsx". No collapse chrome.
 *
 * Multiple files (ops.length > 1):
 *   Collapsible header "Read 2 files ›" driven by data-collapse-id click
 *   delegation in ChatRoot (no ChatRoot changes needed).
 *   - Collapsed + running  → fixed-height streaming preview window that
 *     auto-scrolls to the bottom as new ops arrive (like ActivePreview in
 *     Thinking.tsx).
 *   - Collapsed + settled  → header only.
 *   - Expanded             → full per-file list.
 *
 * Collapse semantics are inverted (same as Thinking):
 *   stored false (default) → not expanded
 *   stored true            → expanded
 *
 * Geometry-coupled rules live in file-op.module.css.
 * All visual styling uses Tailwind utilities.
 */

import { For, Show, createEffect } from 'solid-js';
import type { ChatFileOpToolCall, FileOpKind } from '../../model';
import { FILEOP_LINE_H, FILEOP_PAD_Y, FILEOP_ROW_H, FILEOP_WINDOW_H } from './metrics';
import styles from './file-op.module.css';

const VERB: Record<FileOpKind, string> = {
  read: 'Read',
  edit: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
};

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow(props: { verb: string; path: string }) {
  return (
    <div
      class={`${styles['pfileop__line']} flex items-center gap-1.5 text-sm text-foreground-muted`}
    >
      <span class="text-foreground">{props.verb}</span>
      <span title={props.path}>{basename(props.path)}</span>
    </div>
  );
}

// ── FileOpPreview ─────────────────────────────────────────────────────────────

/**
 * Streaming preview window shown while status === 'running' and collapsed.
 * Auto-scrolls to the bottom whenever the ops list grows.
 */
function FileOpPreview(props: { item: ChatFileOpToolCall; verb: string }) {
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    // Reading props.item.ops registers this effect as a reactive subscriber
    // so it re-runs on every streaming update to pin the scroll to bottom.
    if (props.item.ops.length > 0 && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  return (
    <div class={`${styles['pfileop__window']} relative overflow-hidden`}>
      <div
        class="fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10 h-[var(--chat-fileop-fade-h)]"
        aria-hidden="true"
      />
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        class={`${styles['pfileop__window-scroll']} overflow-y-auto text-foreground-passive`}
      >
        <div style={{ 'padding-block': `${FILEOP_PAD_Y}px` }}>
          <For each={props.item.ops}>{(op) => <FileRow verb={props.verb} path={op.path} />}</For>
        </div>
      </div>
    </div>
  );
}

// ── FileOperation ─────────────────────────────────────────────────────────────

export type FileOperationProps = {
  item: ChatFileOpToolCall;
  /** Inverted semantics: stored "collapsed" bool means "expanded". */
  collapsed?: boolean;
};

export function FileOperation(props: FileOperationProps) {
  const verb = () => VERB[props.item.op];
  // Inverted: stored collapsed = true means expanded.
  const expanded = () => !!props.collapsed;

  // Height of the multi-file container without ROW_GAP (Row.tsx accounts for gap).
  const multiH = () => {
    if (expanded()) {
      return FILEOP_ROW_H + props.item.ops.length * FILEOP_LINE_H + 2 * FILEOP_PAD_Y;
    }
    if (props.item.status === 'running') return FILEOP_ROW_H + FILEOP_WINDOW_H;
    return FILEOP_ROW_H;
  };

  return (
    <Show
      when={props.item.ops.length > 1}
      fallback={
        // ── Single file ────────────────────────────────────────────────────────
        <div class={`${styles.pfileop} flex items-center`} style={{ height: `${FILEOP_ROW_H}px` }}>
          <Show
            when={props.item.ops[0]}
            fallback={
              <span
                class="font-mono text-sm"
                classList={{ 'text-shimmer': props.item.status === 'running' }}
              >
                {verb()}…
              </span>
            }
          >
            {(op) => <FileRow verb={verb()} path={op().path} />}
          </Show>
        </div>
      }
    >
      {/* ── Multiple files ──────────────────────────────────────────────────── */}
      <div class={styles.pfileop} style={{ position: 'relative', height: `${multiH()}px` }}>
        {/* Header */}
        <div
          class={`${styles['pfileop__header']} flex cursor-pointer items-center gap-1.5 select-none hover:text-foreground`}
          role="button"
          aria-expanded={expanded() ? 'true' : 'false'}
          data-collapse-id={props.item.id}
        >
          <span
            class="text-sm text-foreground-muted"
            classList={{ 'text-shimmer': props.item.status === 'running' }}
          >
            {verb()} {props.item.ops.length} files
          </span>
          <span
            class="inline-block text-[10px] text-foreground-muted transition-transform duration-150 ease-out"
            classList={{ 'rotate-90': expanded() }}
            aria-hidden="true"
          >
            ›
          </span>
        </div>

        {/* Body: expanded list or streaming preview */}
        <Show
          when={expanded()}
          fallback={
            <Show when={props.item.status === 'running'}>
              <div class={styles['pfileop__body']}>
                <FileOpPreview item={props.item} verb={verb()} />
              </div>
            </Show>
          }
        >
          <div class={styles['pfileop__body']}>
            <div style={{ 'padding-block': `${FILEOP_PAD_Y}px` }}>
              <For each={props.item.ops}>{(op) => <FileRow verb={verb()} path={op.path} />}</For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

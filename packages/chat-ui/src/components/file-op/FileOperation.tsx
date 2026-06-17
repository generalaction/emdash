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
 * Geometry comes from ThemeContext (useTheme) instead of CSS vars.
 * All visual styling uses Tailwind utilities.
 */

import { For, Show, createEffect } from 'solid-js';
import type { ChatFileOpToolCall, FileOpKind } from '../../model';
import { useCommands } from '../CommandsContext';
import { useTheme } from '../ThemeContext';

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

function FileRow(props: { verb: string; path: string; lineH: number; onClick?: () => void }) {
  return (
    <div
      class="flex items-center gap-1.5 text-sm text-foreground-passive"
      classList={{ 'cursor-pointer hover:text-foreground-muted': !!props.onClick }}
      style={{ height: `${props.lineH}px` }}
      role={props.onClick ? 'button' : undefined}
      onClick={props.onClick}
    >
      <span>{props.verb}</span>
      <span title={props.path}>{basename(props.path)}</span>
    </div>
  );
}

// ── FileOpPreview ─────────────────────────────────────────────────────────────

function FileOpPreview(props: {
  item: ChatFileOpToolCall;
  verb: string;
  windowH: number;
  fadeH: number;
  padY: number;
  lineH: number;
}) {
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.item.ops.length > 0 && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  return (
    <div class="relative overflow-hidden" style={{ height: `${props.windowH}px` }}>
      <div
        class="fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{ height: `${props.fadeH}px` }}
        aria-hidden="true"
      />
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        class="overflow-y-auto text-foreground-passive"
        style={{ 'max-height': `${props.windowH}px`, 'scrollbar-gutter': 'stable' }}
      >
        <div style={{ 'padding-block': `${props.padY}px` }}>
          <For each={props.item.ops}>
            {(op) => <FileRow verb={props.verb} path={op.path} lineH={props.lineH} />}
          </For>
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
  const theme = useTheme();
  const g = () => theme().geometry;
  const commands = useCommands();

  const verb = () => VERB[props.item.op];

  const openFile = (path: string) => {
    commands().onOpenFile?.({ path, itemId: props.item.id, source: 'file-op' });
  };
  // Inverted: stored collapsed = true means expanded.
  const expanded = () => !!props.collapsed;

  // Height of the multi-file container without row padding (Row.tsx adds that).
  const multiH = () => {
    const { fileopRowH, fileopLineH, fileopPadY, fileopWindowH } = g();
    if (expanded()) {
      return fileopRowH + props.item.ops.length * fileopLineH + 2 * fileopPadY;
    }
    if (props.item.status === 'running') return fileopRowH + fileopWindowH;
    return fileopRowH;
  };

  return (
    <Show
      when={props.item.ops.length > 1}
      fallback={
        // ── Single file ─────────────────────────────────────────────────────
        <div
          class="flex items-center"
          style={{
            height: `${g().fileopRowH}px`,
            'padding-inline': `${g().rowInsetX}px`,
          }}
        >
          <Show
            when={props.item.ops[0]}
            fallback={
              <span
                class="font-mono text-sm text-foreground-passive"
                classList={{ 'text-shimmer': props.item.status === 'running' }}
              >
                {verb()}…
              </span>
            }
          >
            {(op) => (
              <FileRow
                verb={verb()}
                path={op().path}
                lineH={g().fileopLineH}
                onClick={() => openFile(op().path)}
              />
            )}
          </Show>
        </div>
      }
    >
      {/* ── Multiple files ──────────────────────────────────────────────── */}
      <div
        style={{
          position: 'relative',
          height: `${multiH()}px`,
          'padding-inline': `${g().rowInsetX}px`,
        }}
      >
        {/* Header */}
        <div
          class="flex cursor-pointer items-center gap-1.5 text-sm text-foreground-passive select-none hover:text-foreground-muted"
          style={{ height: `${g().fileopRowH}px` }}
          role="button"
          aria-expanded={expanded() ? 'true' : 'false'}
          data-collapse-id={props.item.id}
        >
          <span classList={{ 'text-shimmer': props.item.status === 'running' }}>
            {verb()} {props.item.ops.length} files
          </span>
          <span
            class="inline-block text-[10px] transition-transform duration-150 ease-out"
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
              <div
                style={{
                  position: 'absolute',
                  top: `${g().fileopRowH}px`,
                  left: `${g().rowInsetX}px`,
                  right: `${g().rowInsetX}px`,
                }}
              >
                <FileOpPreview
                  item={props.item}
                  verb={verb()}
                  windowH={g().fileopWindowH}
                  fadeH={g().fileopFadeH}
                  padY={g().fileopPadY}
                  lineH={g().fileopLineH}
                />
              </div>
            </Show>
          }
        >
          <div
            style={{
              position: 'absolute',
              top: `${g().fileopRowH}px`,
              left: `${g().rowInsetX}px`,
              right: `${g().rowInsetX}px`,
            }}
          >
            <div style={{ 'padding-block': `${g().fileopPadY}px` }}>
              <For each={props.item.ops}>
                {(op) => (
                  <FileRow
                    verb={verb()}
                    path={op.path}
                    lineH={g().fileopLineH}
                    onClick={() => openFile(op.path)}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

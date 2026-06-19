/**
 * Diff — slot components for ChatDiff rows.
 *
 * DiffHeader   — clickable file header (rendered in the 'diff:header' slot).
 * DiffLines    — diff line body with Shiki syntax highlighting
 *                (rendered in the 'diff:body' slot inside ProjectWindow).
 *
 * Both components are pure content; outer geometry is handled by the compose
 * tree built in diffDef (stack + scrollWindow + slot nodes rendered by Project).
 */

import { For, Show, createEffect, onCleanup } from 'solid-js';
import { applyTokensToElement } from '../../core/highlight/apply-tokens';
import type { CodeToken } from '../../core/highlight/highlighter';
import { resolveFileIconClass } from '../../lib/file-icons';
import { basename } from '../../lib/path';
import type { ChatDiff } from '../../model';
import { useCaches } from '../CachesContext';
import { useCommands } from '../CommandsContext';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import { GenericFileIcon } from '../primitives/icons';
import type { DiffRow } from './diff-lines';
import type { DiffLayout } from './diff.def';
import styles from './diff.module.css';

// ── Row style map ──────────────────────────────────────────────────────────────

const ROW_CLASS: Record<DiffRow['type'], string> = {
  add: 'bg-chat-diff-added/10 border-l-[3px] border-chat-diff-added',
  remove: 'bg-chat-diff-deleted/10 border-l-[3px] border-chat-diff-deleted',
  context: 'border-l-[3px] border-transparent',
};

// ── DiffHeader ────────────────────────────────────────────────────────────────

export type DiffHeaderProps = {
  item: ChatDiff;
  adds: number;
  dels: number;
  headerH: number;
  /**
   * Whether a diff body is rendered below this header. Controls the border
   * shape: with a body the header owns the top + side edges and the separator
   * (`rounded-t`), standalone it owns the full rounded card border.
   */
  hasBody: boolean;
};

export function DiffHeader(props: DiffHeaderProps) {
  const name = () => basename(props.item.path);
  const iconClass = () => resolveFileIconClass(name());
  const running = () => props.item.status === 'running';
  // Stats are meaningless until a diff body exists; hide them while streaming
  // the header alone or when there are genuinely no changes.
  const showStats = () => props.hasBody && (props.adds > 0 || props.dels > 0);
  const commands = useCommands();

  const handleClick = () => {
    commands().onOpenFile?.({ path: props.item.path, itemId: props.item.id, source: 'diff' });
  };

  return (
    <div
      class="hover:bg-chat-bg-3 border-chat-border flex cursor-pointer items-center gap-2 px-2 text-xs transition-colors"
      classList={{
        'rounded-lg border': !props.hasBody,
        'rounded-t-lg border-x border-t border-b': props.hasBody,
      }}
      style={{ height: `${props.headerH}px` }}
      role="button"
      onClick={handleClick}
    >
      {iconClass() ? (
        <i
          class={`${iconClass()} shrink-0`}
          style={{ 'font-size': '12px', 'line-height': '1' }}
          aria-hidden="true"
        />
      ) : (
        <GenericFileIcon />
      )}
      <span
        class="text-chat-fg-muted min-w-0 truncate text-sm"
        classList={{ 'text-shimmer': running() }}
        title={props.item.path}
      >
        {name()}
      </span>
      <Show when={showStats()}>
        <span class="text-chat-diff-added shrink-0 text-sm">+{props.adds}</span>
        <span class="text-chat-diff-deleted shrink-0 text-sm">−{props.dels}</span>
      </Show>
      <span class="flex-1" />
    </div>
  );
}

// ── DiffLines ─────────────────────────────────────────────────────────────────

export type DiffLinesProps = {
  item: ChatDiff;
  layout: DiffLayout;
  codeLineHeight: () => number;
};

export function DiffLines(props: DiffLinesProps) {
  const caches = useCaches();
  const lineEls = new Map<number, HTMLElement>();

  createEffect(() => {
    const { previewRows, lang } = props.layout;
    if (!previewRows.length || !lang) return;

    const oldCode = props.item.oldText ?? '';
    const newCode = props.item.newText;

    function paint(newLines: CodeToken[][], oldLines: CodeToken[][]): void {
      for (let i = 0; i < previewRows.length; i++) {
        const row = previewRows[i];
        const el = lineEls.get(i);
        if (!row || !el) continue;

        let tokens: CodeToken[] | undefined;
        if (row.type === 'remove' && row.oldIdx !== undefined) {
          tokens = oldLines[row.oldIdx];
        } else if (row.newIdx !== undefined) {
          tokens = newLines[row.newIdx];
        }
        if (tokens) applyTokensToElement(el, tokens);
      }
    }

    const newHl = caches.peekHighlight(newCode, lang);
    const oldHl = props.item.oldText
      ? caches.peekHighlight(oldCode, lang)
      : { lines: [] as CodeToken[][], rootStyle: '' };
    if (newHl && oldHl) {
      paint(newHl.lines, oldHl.lines);
      return;
    }

    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled) return;
      const newResult = caches.highlight(newCode, lang);
      const oldResult = props.item.oldText ? caches.highlight(oldCode, lang) : null;
      if (cancelled) return;
      paint(newResult?.lines ?? [], oldResult?.lines ?? []);
    });

    onCleanup(() => {
      cancelled = true;
      cancelIdle(handle);
    });
  });

  // Geometry source of truth: each row is pinned to the exact line height that
  // diffDef.measure() reserved (theme.fonts.code.lineHeight). Applied inline so
  // the rendered height never drifts from the measured height via a CSS variable.
  const lineH = () => props.codeLineHeight();

  return (
    <div class="border-chat-border overflow-hidden rounded-b-lg border-x border-b">
      <div class={styles['pdiff__body']}>
        <For each={props.layout.previewRows}>
          {(row, i) => (
            <div class={`flex ${ROW_CLASS[row.type]}`} style={{ height: `${lineH()}px` }}>
              <span
                ref={(el) => {
                  lineEls.set(i(), el);
                  onCleanup(() => lineEls.delete(i()));
                }}
                class={`${styles['pdiff__line']} text-chat-fg flex-1 overflow-hidden px-3`}
                style={{ 'line-height': `${lineH()}px` }}
              >
                {row.text}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ── Diff (legacy combined component for contract tests) ───────────────────────

/**
 * @deprecated Use diffDef.Render via Project instead.
 * Kept for backward compatibility with open-file.contract.test.tsx.
 */
export type DiffProps = {
  item: ChatDiff;
  layout: DiffLayout;
  codeLineHeight: () => number;
};

export function Diff(props: DiffProps) {
  return (
    <div>
      <DiffHeader
        item={props.item}
        adds={props.layout.adds}
        dels={props.layout.dels}
        headerH={32}
        hasBody
      />
      <DiffLines item={props.item} layout={props.layout} codeLineHeight={props.codeLineHeight} />
    </div>
  );
}

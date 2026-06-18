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

import { resolveFileIconClass } from '@emdash/ui/primitives';
import { For, createEffect, onCleanup } from 'solid-js';
import { applyTokensToElement } from '../../core/highlight/apply-tokens';
import type { CodeToken } from '../../core/highlight/highlighter';
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
  add: 'bg-foreground-diff-added/10 border-l-[3px] border-foreground-diff-added',
  remove: 'bg-foreground-diff-deleted/10 border-l-[3px] border-foreground-diff-deleted',
  context: 'border-l-[3px] border-transparent',
};

// ── DiffHeader ────────────────────────────────────────────────────────────────

export type DiffHeaderProps = {
  item: ChatDiff;
  adds: number;
  dels: number;
  headerH: number;
};

export function DiffHeader(props: DiffHeaderProps) {
  const name = () => basename(props.item.path);
  const iconClass = () => resolveFileIconClass(name());
  const commands = useCommands();

  const handleClick = () => {
    commands().onOpenFile?.({ path: props.item.path, itemId: props.item.id, source: 'diff' });
  };

  return (
    <div
      class="hover:bg-background-hover flex cursor-pointer items-center gap-2 border-b border-border px-3 text-xs"
      style={{ height: `${props.headerH}px` }}
      role="button"
      onClick={handleClick}
    >
      {iconClass() ? (
        <i
          class={`${iconClass()} shrink-0`}
          style={{ 'font-size': '14px', 'line-height': '1' }}
          aria-hidden="true"
        />
      ) : (
        <GenericFileIcon />
      )}
      <span class="min-w-0 truncate text-sm text-foreground-muted" title={props.item.path}>
        {name()}
      </span>
      <span class="shrink-0 text-sm text-foreground-diff-added">+{props.adds}</span>
      <span class="shrink-0 text-sm text-foreground-diff-deleted">−{props.dels}</span>
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

  return (
    <div class="overflow-hidden rounded-b-lg border-x border-b border-border">
      <div class={styles['pdiff__body']}>
        <For each={props.layout.previewRows}>
          {(row, i) => (
            <div class={`flex ${ROW_CLASS[row.type]}`}>
              <span
                ref={(el) => {
                  lineEls.set(i(), el);
                  onCleanup(() => lineEls.delete(i()));
                }}
                class={`${styles['pdiff__line']} flex-1 overflow-hidden px-3 text-foreground`}
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
    <div class="overflow-hidden rounded-lg border border-border">
      <DiffHeader
        item={props.item}
        adds={props.layout.adds}
        dels={props.layout.dels}
        headerH={28}
      />
      <DiffLines item={props.item} layout={props.layout} codeLineHeight={props.codeLineHeight} />
    </div>
  );
}

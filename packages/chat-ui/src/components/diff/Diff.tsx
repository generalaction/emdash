import { resolveFileIconClass } from '@emdash/ui/primitives';
import { For, createEffect, onCleanup } from 'solid-js';
import { type CodeToken, highlightCode, peekHighlight } from '../../core/highlight/highlighter';
import type { ChatDiff } from '../../model';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import { useCommands } from '../CommandsContext';
import type { DiffRow } from './diff-lines';
import type { DiffLayout } from './diff.def';
import styles from './diff.module.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function applyTokens(el: HTMLElement, tokens: CodeToken[]): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const tok of tokens) {
    if (!tok.content) continue;
    if (!tok.htmlStyle) {
      el.appendChild(document.createTextNode(tok.content));
    } else {
      const span = document.createElement('span');
      span.textContent = tok.content;
      for (const [prop, val] of Object.entries(tok.htmlStyle)) {
        span.style.setProperty(prop, val);
      }
      el.appendChild(span);
    }
  }
}

// ── Fallback generic-file SVG icon ────────────────────────────────────────────

function GenericFileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="shrink-0 text-foreground-muted"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ── Row style map ──────────────────────────────────────────────────────────────

const ROW_CLASS: Record<DiffRow['type'], string> = {
  add: 'bg-foreground-diff-added/10 border-l-[3px] border-foreground-diff-added',
  remove: 'bg-foreground-diff-deleted/10 border-l-[3px] border-foreground-diff-deleted',
  context: 'border-l-[3px] border-transparent',
};

// ── DiffHeader ────────────────────────────────────────────────────────────────

function DiffHeader(props: { item: ChatDiff; adds: number; dels: number; headerH: number }) {
  const name = () => basename(props.item.path);
  const iconClass = () => resolveFileIconClass(name());
  const commands = useCommands();

  const handleClick = () => {
    commands().onOpenFile?.({ path: props.item.path, itemId: props.item.id, source: 'diff' });
  };

  return (
    <div
      class="flex cursor-pointer items-center gap-2 border-b border-border px-3 text-xs hover:bg-background-hover"
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

// ── Diff ──────────────────────────────────────────────────────────────────────

export type DiffProps = {
  item: ChatDiff;
  layout: DiffLayout;
  codeLineHeight: () => number;
};

const DIFF_HEADER_H = 28;
const DIFF_FADE_H = 24;

export function Diff(props: DiffProps) {
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
        if (tokens) applyTokens(el, tokens);
      }
    }

    const newHl = peekHighlight(newCode, lang);
    const oldHl = props.item.oldText
      ? peekHighlight(oldCode, lang)
      : { lines: [] as CodeToken[][], rootStyle: '' };
    if (newHl && oldHl) {
      paint(newHl.lines, oldHl.lines);
      return;
    }

    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled) return;
      const newResult = highlightCode(newCode, lang);
      const oldResult = props.item.oldText ? highlightCode(oldCode, lang) : null;
      if (cancelled) return;
      paint(newResult?.lines ?? [], oldResult?.lines ?? []);
    });

    onCleanup(() => {
      cancelled = true;
      cancelIdle(handle);
    });
  });

  return (
    <div class="overflow-hidden rounded-lg border border-border">
      <DiffHeader
        item={props.item}
        adds={props.layout.adds}
        dels={props.layout.dels}
        headerH={DIFF_HEADER_H}
      />
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
        {props.layout.truncated && (
          <div
            class={`${styles['pdiff__fade']} fade-overlay-bottom`}
            style={{ height: `${DIFF_FADE_H}px` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

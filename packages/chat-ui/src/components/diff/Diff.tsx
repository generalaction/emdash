/**
 * Diff — SolidJS component for ChatDiff rows.
 *
 * Renders a compact, non-scrollable diff preview capped at DIFF_MAX_LINES rows:
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │ [TS] model.ts  +3  −1                          (header) │
 * ├─────────────────────────────────────────────────────────┤
 * │   export type ChatToolCall = {                          │
 * │ + kind: 'diff';                                         │
 * │ − kind: 'tool';                                         │
 * └─────────────────────────────────────────────────────────┘
 *
 * Syntax highlighting is applied via an idle callback: tokenize `newText`
 * and `oldText` as whole strings, then look up each preview row's tokens by
 * `newIdx` / `oldIdx` — the same technique used in Code.tsx.
 */

import { For, createEffect, onCleanup } from 'solid-js';
import { type CodeToken, highlightCode, peekHighlight } from '../../core/highlight/highlighter';
import type { ChatDiff } from '../../model';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import type { DiffRow } from './diff-lines';
import { langGlyph } from './lang';
import type { DiffMeasureResult } from './measure';
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

// ── Row background / gutter sign maps ────────────────────────────────────────

const ROW_BG: Record<DiffRow['type'], string> = {
  add: 'bg-foreground-diff-added/10',
  remove: 'bg-foreground-diff-deleted/10',
  context: '',
};

const ROW_SIGN: Record<DiffRow['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
};

// ── DiffHeader ────────────────────────────────────────────────────────────────

function DiffHeader(props: { item: ChatDiff; adds: number; dels: number }) {
  return (
    <div
      class={`${styles['pdiff__header']} flex items-center gap-1.5 border-b border-border text-xs`}
    >
      <span class="shrink-0 rounded bg-foreground-muted/15 px-1 font-mono text-[10px] font-semibold text-foreground-muted">
        {langGlyph(props.item.path)}
      </span>
      <span class="min-w-0 flex-1 truncate text-foreground" title={props.item.path}>
        {basename(props.item.path)}
      </span>
      <span class="shrink-0 text-foreground-diff-added">+{props.adds}</span>
      <span class="shrink-0 text-foreground-diff-deleted">−{props.dels}</span>
    </div>
  );
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export type DiffProps = {
  item: ChatDiff;
  layout: DiffMeasureResult;
};

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

    // Fast path: both sides already cached
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
    <div class={styles.pdiff}>
      <DiffHeader item={props.item} adds={props.layout.adds} dels={props.layout.dels} />
      <div class={styles['pdiff__body']}>
        <For each={props.layout.previewRows}>
          {(row, i) => (
            <div class={`flex ${ROW_BG[row.type]}`}>
              <span class="w-4 shrink-0 text-center font-mono text-foreground-muted/60 select-none">
                {ROW_SIGN[row.type]}
              </span>
              <span
                ref={(el) => {
                  lineEls.set(i(), el);
                  onCleanup(() => lineEls.delete(i()));
                }}
                class={`${styles['pdiff__line']} flex-1 overflow-hidden text-foreground`}
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

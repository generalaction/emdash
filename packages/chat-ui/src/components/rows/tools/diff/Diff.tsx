import { assignInlineVars } from '@vanilla-extract/dynamic';
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { applyTokensToElement } from '../../../../core/highlight/apply-tokens';
import type { CodeToken } from '../../../../core/highlight/highlighter';
import { resolveFileIconClass } from '../../../../lib/file-icons';
import { basename } from '../../../../lib/path';
import type { ChatDiff } from '../../../../model';
import { pxTokens } from '../../../../styles/px-tokens';
import { useCaches } from '../../../contexts/CachesContext';
import { useCommands } from '../../../contexts/CommandsContext';
import { cancelIdle, scheduleIdle } from '../../../engine/dom-utils';
import { GenericFileIcon } from '../../../primitives/icons';
import type { DiffLayout } from './diff.def';
import { pdiffBody, pdiffLine } from './diff.css';
import {
  diffAddsCount,
  diffBodyCard,
  diffDelsCount,
  diffFileName,
  diffHeader,
  diffLineContent,
  diffRowClasses,
  diffSpacer,
  textShimmer,
} from './diff-visual.css';
import { diffCardVars } from './diff-vars.css';

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
      class={diffHeader({ hasBody: props.hasBody })}
      style={assignInlineVars(diffCardVars, pxTokens({ headerH: props.headerH }))}
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
        class={diffFileName}
        classList={{ [textShimmer]: running() }}
        title={props.item.path}
      >
        {name()}
      </span>
      <Show when={showStats()}>
        <span class={diffAddsCount}>+{props.adds}</span>
        <span class={diffDelsCount}>−{props.dels}</span>
      </Show>
      <span class={diffSpacer} />
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
    <div class={diffBodyCard}>
      <div class={pdiffBody}>
        <For each={props.layout.previewRows}>
          {(row, i) => (
            <div class={diffRowClasses[row.type]} style={{ height: `${lineH()}px` }}>
              <span
                ref={(el) => {
                  lineEls.set(i(), el);
                  onCleanup(() => lineEls.delete(i()));
                }}
                class={`${pdiffLine} ${diffLineContent}`}
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

/** @deprecated Use diffDef.Render via Project instead. Kept for open-file.contract.test.tsx. */
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

/**
 * Execute — SolidJS components for ChatExecute rows.
 *
 * Renders ACP `kind: 'execute'` tool calls as a collapsible card:
 *
 *   ┌─────────────────────────────────────┐
 *   │  Execute                          › │  ← header (always visible)
 *   ├─────────────────────────────────────┤
 *   │  pnpm run build --filter=...        │  ← body: mono, bash-highlighted
 *   │  ...                                │    clamped to collapsedMaxLines or
 *   └─────────────────────────────────────┘    expandedMaxLines with overflow scroll
 *
 * Header: shimmer while running, chevron rotates when expanded.
 * Body:   collapsed = clamped height + fade overlay; expanded = scrollable.
 * Card geometry (height) is owned by execute.def via executeVars; this file
 * only describes inner content.
 */

import { useCaches } from '@components/contexts/CachesContext';
import { cancelIdle, scheduleIdle } from '@components/engine/dom-utils';
import { applyTokensToElement, type CodeToken } from '@core/highlight/apply-tokens';
import { fadeOverlayBottom } from '@styles/effects.css';
import { For, Show, createEffect, onCleanup } from 'solid-js';
import type { ChatExecute } from '@/model';
import {
  executeBody,
  executeChevron,
  executeHeader,
  executeLine,
  textShimmer,
} from './execute.css';

// ── ExecuteHeader ─────────────────────────────────────────────────────────────

export type ExecuteHeaderProps = {
  item: ChatExecute;
  expanded: boolean;
  headerH: number;
};

export function ExecuteHeader(props: ExecuteHeaderProps) {
  return (
    <div
      class={executeHeader}
      style={{ height: `${props.headerH}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.item.id}
    >
      <span classList={{ [textShimmer]: props.item.status === 'running' }}>Execute</span>
      <span class={executeChevron({ expanded: props.expanded })} aria-hidden="true">
        ›
      </span>
    </div>
  );
}

// ── ExecuteBody ───────────────────────────────────────────────────────────────

export type ExecuteBodyProps = {
  item: ChatExecute;
  lines: string[];
  bodyH: number;
  contentH: number;
  codeLineH: number;
  expanded: boolean;
};

export function ExecuteBody(props: ExecuteBodyProps) {
  const caches = useCaches();
  const lineEls = new Map<number, HTMLElement>();

  createEffect(() => {
    const command = props.item.command;
    if (!command || !lineEls.size) return;

    function paint(tokenLines: CodeToken[][]): void {
      for (let i = 0; i < props.lines.length; i++) {
        const el = lineEls.get(i);
        const tokens = tokenLines[i];
        if (el && tokens) applyTokensToElement(el, tokens);
      }
    }

    const cached = caches.peekHighlight(command, 'bash');
    if (cached) {
      paint(cached.lines);
      return;
    }

    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled) return;
      const result = caches.highlight(command, 'bash');
      if (cancelled || !result) return;
      paint(result.lines);
    });

    onCleanup(() => {
      cancelled = true;
      cancelIdle(handle);
    });
  });

  const overflows = () => props.contentH > props.bodyH;

  return (
    <div
      class={executeBody}
      style={{
        height: `${props.bodyH}px`,
        'overflow-x': 'auto',
        'overflow-y': props.expanded ? 'auto' : 'hidden',
      }}
    >
      <Show when={!props.expanded && overflows()}>
        <div
          class={fadeOverlayBottom}
          style={{ position: 'absolute', inset: '0', 'pointer-events': 'none', height: '28px', bottom: '0', top: 'auto' }}
          aria-hidden="true"
        />
      </Show>
      <For each={props.lines}>
        {(line, i) => (
          <div
            ref={(el) => {
              lineEls.set(i(), el);
              onCleanup(() => lineEls.delete(i()));
            }}
            class={executeLine}
            style={{
              height: `${props.codeLineH}px`,
              'line-height': `${props.codeLineH}px`,
            }}
          >
            {line}
          </div>
        )}
      </For>
    </div>
  );
}
